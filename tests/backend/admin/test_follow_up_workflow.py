"""Follow-up Workflow V2 backend behaviour.

Every test runs against an in-memory Firestore double. Nothing here reaches
Google, and nothing touches the single legitimate production document.
"""

import re

import pytest

from conftest import TEST_ADMIN_EMAIL, TEST_MEMBER_UID

ORIGIN = "https://admin.test"


# --------------------------------------------------------------- doubles


class FakeSnapshot:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class FakeDocument:
    def __init__(self, store, doc_id):
        self._store = store
        self.id = doc_id

    def get(self):
        return FakeSnapshot(self._store.get(self.id))

    def set(self, data, merge=False):
        if merge and self.id in self._store:
            merged = dict(self._store[self.id])
            merged.update(data)
            self._store[self.id] = merged
        else:
            self._store[self.id] = dict(data)

    def to_dict(self):
        return dict(self._store.get(self.id) or {})


class FakeCollection:
    def __init__(self, store):
        self._store = store

    def document(self, doc_id):
        return FakeDocument(self._store, doc_id)

    def stream(self):
        for doc_id in list(self._store):
            document = FakeDocument(self._store, doc_id)
            document.exists = True
            yield document


class FakeDb:
    def __init__(self, collections):
        self._collections = collections

    def collection(self, name):
        return FakeCollection(self._collections.setdefault(name, {}))


@pytest.fixture
def firestore_state(admin_module, monkeypatch):
    """Two databases, mirroring production: members (tulsahub, read) and
    followUpStatus (gdg-tulsa, write)."""
    members = {"member-doc": {"uid": TEST_MEMBER_UID, "name": "Fixture Member"}}
    follow_ups = {}

    member_db = FakeDb({"members": members})
    follow_up_db = FakeDb({"followUpStatus": follow_ups})

    def fake_client(app=None):
        return follow_up_db if app is admin_module.followup_app else member_db

    monkeypatch.setattr(admin_module.firestore, "client", fake_client)
    monkeypatch.setattr(
        admin_module.firestore, "SERVER_TIMESTAMP", "SERVER_TIME", raising=False
    )
    return {"members": members, "follow_ups": follow_ups}


@pytest.fixture
def member_reference(admin_module):
    return admin_module.member_ref(TEST_MEMBER_UID)


def patch(client, ref, body):
    """Mutations require a same-origin Origin header; the check fails closed
    when it is absent, so every legitimate request must send one."""
    return client.patch(
        f"/api/follow-ups/{ref}",
        json=body,
        base_url=ORIGIN,
        headers={"Origin": ORIGIN},
    )


# ------------------------------------------------------ backward compatibility


def test_status_only_document_still_reads(admin_module):
    """Exactly what production holds today: one field, nothing else."""
    state = admin_module.follow_up_state({"status": "reviewed"})

    assert state["status"] == "reviewed"
    assert state["priority"] is None
    assert state["owner"] is None
    assert state["note"] == ""
    assert state["next_action"] == ""
    assert state["last_contacted_at"] is None
    assert state["follow_up_at"] is None


def test_missing_document_defaults(admin_module):
    state = admin_module.follow_up_state(None)
    assert state["status"] == "new"
    assert state["priority"] is None


def test_unknown_stored_values_are_ignored(admin_module):
    state = admin_module.follow_up_state(
        {"status": "bogus", "priority": "urgent", "note": 12}
    )
    assert state["status"] == "new"
    assert state["priority"] is None
    assert state["note"] == ""


def test_status_only_document_survives_a_partial_update(
        signed_in, firestore_state, member_reference):
    firestore_state["follow_ups"][member_reference] = {"status": "reviewed"}

    response = patch(signed_in, member_reference, {"priority": "high"})

    assert response.status_code == 200
    stored = firestore_state["follow_ups"][member_reference]
    assert stored["status"] == "reviewed"
    assert stored["priority"] == "high"


# ------------------------------------------------------------- validation


def test_valid_priority(signed_in, firestore_state, member_reference):
    assert patch(signed_in, member_reference, {"priority": "medium"}).status_code == 200
    assert firestore_state["follow_ups"][member_reference]["priority"] == "medium"


def test_priority_can_be_cleared(signed_in, firestore_state, member_reference):
    patch(signed_in, member_reference, {"priority": "high"})
    assert patch(signed_in, member_reference, {"priority": None}).status_code == 200
    assert firestore_state["follow_ups"][member_reference]["priority"] is None


@pytest.mark.parametrize("value", ["urgent", "HIGH", 1, True, [], {}])
def test_invalid_priority_rejected(signed_in, firestore_state, member_reference, value):
    response = patch(signed_in, member_reference, {"priority": value})
    assert response.status_code == 400
    assert member_reference not in firestore_state["follow_ups"]


def test_valid_note(signed_in, firestore_state, member_reference):
    assert patch(signed_in, member_reference, {"note": "  Spoke at DevFest  "}).status_code == 200
    assert firestore_state["follow_ups"][member_reference]["note"] == "Spoke at DevFest"


def test_oversized_note_rejected(signed_in, firestore_state, member_reference):
    response = patch(signed_in, member_reference, {"note": "x" * 2001})
    assert response.status_code == 400
    assert member_reference not in firestore_state["follow_ups"]


def test_note_at_limit_accepted(signed_in, firestore_state, member_reference):
    assert patch(signed_in, member_reference, {"note": "x" * 2000}).status_code == 200


def test_control_characters_stripped_from_note(signed_in, firestore_state, member_reference):
    patch(signed_in, member_reference, {"note": "line\x00one\x07two"})
    assert firestore_state["follow_ups"][member_reference]["note"] == "lineonetwo"


def test_oversized_next_action_rejected(signed_in, firestore_state, member_reference):
    assert patch(signed_in, member_reference, {"nextAction": "x" * 501}).status_code == 400


def test_valid_next_action(signed_in, firestore_state, member_reference):
    assert patch(signed_in, member_reference, {"nextAction": "Email organizer"}).status_code == 200
    assert firestore_state["follow_ups"][member_reference]["nextAction"] == "Email organizer"


@pytest.mark.parametrize("value", ["not-a-date", "2026-13-45", "", 12345, True, "1899-01-01"])
def test_invalid_follow_up_at_rejected(signed_in, firestore_state, member_reference, value):
    assert patch(signed_in, member_reference, {"followUpAt": value}).status_code == 400
    assert member_reference not in firestore_state["follow_ups"]


@pytest.mark.parametrize("value", ["2026-09-10", "2026-09-10T00:00:00Z", "2026-09-10T14:30:00+02:00"])
def test_valid_follow_up_at_normalised_to_utc_midnight(
        signed_in, firestore_state, member_reference, value):
    assert patch(signed_in, member_reference, {"followUpAt": value}).status_code == 200
    stored = firestore_state["follow_ups"][member_reference]["followUpAt"]
    assert stored.hour == 0 and stored.minute == 0 and stored.second == 0
    assert stored.tzinfo is not None


def test_follow_up_at_can_be_cleared(signed_in, firestore_state, member_reference):
    patch(signed_in, member_reference, {"followUpAt": "2026-09-10"})
    assert patch(signed_in, member_reference, {"followUpAt": None}).status_code == 200
    assert firestore_state["follow_ups"][member_reference]["followUpAt"] is None


@pytest.mark.parametrize("value", ["yesterday", "", 0, "3000-01-01"])
def test_invalid_last_contacted_rejected(signed_in, firestore_state, member_reference, value):
    assert patch(signed_in, member_reference, {"lastContactedAt": value}).status_code == 400


# ------------------------------------------------------- protected fields


@pytest.mark.parametrize("field", ["updatedAt", "updatedBy", "member_ref", "memberRef", "nope"])
def test_unknown_or_protected_fields_rejected(
        signed_in, firestore_state, member_reference, field):
    response = patch(signed_in, member_reference, {"status": "reviewed", field: "x"})
    assert response.status_code == 400
    assert response.get_json()["error"] == "unknown field"
    assert member_reference not in firestore_state["follow_ups"]


def test_updated_by_is_server_generated(signed_in, firestore_state, member_reference, admin_module):
    patch(signed_in, member_reference, {"status": "reviewed"})
    stored = firestore_state["follow_ups"][member_reference]
    assert stored["updatedBy"] == admin_module.admin_session_hash(TEST_ADMIN_EMAIL)


def test_updated_at_is_server_generated(signed_in, firestore_state, member_reference):
    patch(signed_in, member_reference, {"status": "reviewed"})
    assert firestore_state["follow_ups"][member_reference]["updatedAt"] == "SERVER_TIME"


def test_empty_body_rejected(signed_in, firestore_state, member_reference):
    assert patch(signed_in, member_reference, {}).status_code == 400


# --------------------------------------------------------------- workflow


def test_mark_contacted_now(signed_in, firestore_state, member_reference):
    """One controlled action: the server sets both the status and the moment."""
    response = patch(signed_in, member_reference, {"contactedNow": True})

    assert response.status_code == 200
    stored = firestore_state["follow_ups"][member_reference]
    assert stored["status"] == "contacted"
    assert stored["lastContactedAt"] == "SERVER_TIME"


def test_contacted_now_ignores_any_browser_timestamp(
        signed_in, firestore_state, member_reference):
    patch(signed_in, member_reference,
          {"contactedNow": True, "lastContactedAt": "2001-01-01"})
    assert firestore_state["follow_ups"][member_reference]["lastContactedAt"] == "SERVER_TIME"


def test_assign_to_me(signed_in, firestore_state, member_reference, admin_module):
    response = patch(signed_in, member_reference, {"assignToMe": True})

    assert response.status_code == 200
    stored = firestore_state["follow_ups"][member_reference]
    assert stored["owner"] == admin_module.admin_session_hash(TEST_ADMIN_EMAIL)


def test_owner_must_be_a_known_admin(signed_in, firestore_state, member_reference):
    """Free-text owners are refused; only an allowlisted admin id is assignable."""
    for value in ["someone@example.com", "<script>x</script>", "a" * 64, 1]:
        assert patch(signed_in, member_reference, {"owner": value}).status_code == 400

    assert member_reference not in firestore_state["follow_ups"]


def test_owner_can_be_unassigned(signed_in, firestore_state, member_reference):
    patch(signed_in, member_reference, {"assignToMe": True})
    assert patch(signed_in, member_reference, {"owner": None}).status_code == 200
    assert firestore_state["follow_ups"][member_reference]["owner"] is None


def test_owner_label_resolved_server_side(admin_module):
    directory = admin_module.admin_directory()
    digest = admin_module.admin_session_hash(TEST_ADMIN_EMAIL)
    state = admin_module.follow_up_state({"owner": digest}, directory)

    assert state["owner"] == digest
    assert state["owner_label"] == TEST_ADMIN_EMAIL


# ------------------------------------------------------------ concurrency


def test_stale_update_rejected(signed_in, firestore_state, member_reference):
    patch(signed_in, member_reference, {"status": "reviewed"})
    firestore_state["follow_ups"][member_reference]["updatedAt"] = "2026-09-05T10:00:00+00:00"

    response = patch(signed_in, member_reference,
                     {"note": "mine", "expectedUpdatedAt": "2026-01-01T00:00:00+00:00"})

    assert response.status_code == 409
    assert "follow_up" in response.get_json()
    assert firestore_state["follow_ups"][member_reference].get("note") != "mine"


def test_matching_updated_at_accepted(signed_in, firestore_state, member_reference):
    firestore_state["follow_ups"][member_reference] = {
        "status": "reviewed", "updatedAt": "2026-09-05T10:00:00+00:00"
    }
    response = patch(signed_in, member_reference,
                     {"note": "ok", "expectedUpdatedAt": "2026-09-05T10:00:00+00:00"})
    assert response.status_code == 200


def test_omitting_expected_updated_at_is_last_write_wins(
        signed_in, firestore_state, member_reference):
    firestore_state["follow_ups"][member_reference] = {
        "status": "reviewed", "updatedAt": "2026-09-05T10:00:00+00:00"
    }
    assert patch(signed_in, member_reference, {"note": "overwrite"}).status_code == 200


# --------------------------------------------------------------- security


def test_unauthenticated_patch(client, member_reference):
    assert patch(client, member_reference, {"status": "reviewed"}).status_code == 401


def test_cross_origin_patch_denied(signed_in, member_reference):
    response = signed_in.patch(
        f"/api/follow-ups/{member_reference}",
        json={"status": "reviewed"},
        base_url=ORIGIN,
        headers={"Origin": "https://evil.test"},
    )
    assert response.status_code == 403


@pytest.mark.parametrize("ref", ["short", "g" * 64, "A" * 64, "../../etc", "a" * 63, ""])
def test_invalid_member_reference_rejected(signed_in, ref):
    response = signed_in.patch(
        f"/api/follow-ups/{ref}", json={"status": "reviewed"},
        base_url=ORIGIN, headers={"Origin": ORIGIN})
    assert response.status_code in (400, 404, 405)


def test_unknown_member_reference_creates_no_document(signed_in, firestore_state):
    response = signed_in.patch(
        f"/api/follow-ups/{'a' * 64}", json={"status": "reviewed"},
        base_url=ORIGIN, headers={"Origin": ORIGIN})
    assert response.status_code == 404
    assert firestore_state["follow_ups"] == {}


def test_oversized_payload_rejected(signed_in, member_reference):
    response = signed_in.patch(
        f"/api/follow-ups/{member_reference}",
        data="x" * 5000,
        content_type="application/json",
        base_url=ORIGIN,
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 413


# ------------------------------------------------------------------ privacy


def test_write_contains_no_member_pii(signed_in, firestore_state, member_reference):
    """The operational store keys on member_ref and holds nothing readable."""
    patch(signed_in, member_reference, {
        "status": "contacted", "priority": "high", "note": "Met at DevFest",
        "nextAction": "Email organizer", "followUpAt": "2026-10-01",
    })

    stored = firestore_state["follow_ups"][member_reference]
    blob = repr(stored)

    for forbidden in [TEST_MEMBER_UID, "Fixture Member", "@", "email", "uid", "anonymous_id"]:
        assert forbidden not in blob, f"{forbidden} reached followUpStatus"

    assert set(stored) <= {
        "status", "priority", "owner", "note", "nextAction",
        "lastContactedAt", "followUpAt", "updatedAt", "updatedBy",
    }


def test_document_id_is_the_member_ref(signed_in, firestore_state, member_reference):
    patch(signed_in, member_reference, {"status": "reviewed"})
    assert list(firestore_state["follow_ups"]) == [member_reference]
    assert re.fullmatch(r"[0-9a-f]{64}", member_reference)


def test_note_markup_is_stored_verbatim_not_escaped(
        signed_in, firestore_state, member_reference):
    """The dashboard renders through textContent, so markup is displayed as
    text; mangling it here would lose what the operator actually typed."""
    patch(signed_in, member_reference, {"note": "<script>alert(1)</script>"})
    assert firestore_state["follow_ups"][member_reference]["note"] == "<script>alert(1)</script>"
