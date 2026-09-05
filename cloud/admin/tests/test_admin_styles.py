"""Design-system and responsive guarantees in admin.css."""

import re


def test_design_tokens_defined(admin_css):
    root = admin_css[admin_css.index(":root {"): admin_css.index("* {")]
    for token in [
        "--admin-bg", "--admin-surface", "--admin-text", "--admin-border",
        "--admin-primary", "--admin-success", "--admin-warning",
        "--admin-danger", "--radius-sm", "--radius-md", "--radius-lg",
        "--shadow-card",
    ]:
        assert f"{token}:" in root


def test_no_undefined_custom_properties(admin_css):
    used = set(re.findall(r"var\((--[a-z-]+)\)", admin_css))
    defined = set(re.findall(r"^\s*(--[a-z-]+):", admin_css, re.M))
    assert used <= defined


def test_body_cannot_scroll_horizontally(admin_css):
    body = admin_css[admin_css.index("body {"):]
    assert "overflow-x: hidden;" in body[: body.index("}")]


def test_wide_tables_scroll_inside_their_card(admin_css):
    block = admin_css[admin_css.index(".table-scroll {"):]
    assert "overflow-x: auto;" in block[: block.index("}")]


def test_reduced_motion_is_honoured(admin_css):
    assert "@media (prefers-reduced-motion: reduce)" in admin_css


def test_focus_is_always_visible(admin_css):
    assert ":focus-visible" in admin_css
    block = admin_css[admin_css.index(":focus-visible"):]
    assert "outline: 2px solid" in block[: block.index("}")]


def test_responsive_breakpoints_present(admin_css):
    widths = sorted(int(w) for w in re.findall(r"max-width: (\d+)px", admin_css))
    assert 1280 in widths
    assert 1024 in widths
    assert 520 in widths


def test_high_interest_is_not_styled_as_an_error(admin_css):
    block = admin_css[admin_css.index(".badge-high {"):]
    block = block[: block.index("}")]
    assert "--admin-success" in block
    assert "--admin-danger" not in block


def test_no_dark_mode_was_introduced(admin_css):
    assert "prefers-color-scheme" not in admin_css


def test_hidden_attribute_always_wins(admin_css):
    assert "display: none !important;" in admin_css
