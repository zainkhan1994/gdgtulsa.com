# Local Setup

1. Clone the repository.
2. Run `./scripts/bootstrap.sh`.
3. Run `./scripts/build.sh`.
4. Serve the generated site with `python3 -m http.server 8000 --directory build`.
5. Open `http://localhost:8000`.

Backend services install dependencies from their service-local requirements files under `src/backend/services/`.
