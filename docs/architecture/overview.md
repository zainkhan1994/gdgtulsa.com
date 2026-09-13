# Architecture Overview

GDG Tulsa is a static frontend hosted on GitHub Pages with Firebase-backed member features and separate Python services on Google Cloud Run and Cloud Functions.

The frontend source lives in `src/frontend`. `scripts/build.sh` creates the root-relative GitHub Pages artifact in `build/`.

## Request Flow

```mermaid
flowchart LR
	Visitor[Visitor browser] --> Pages[GitHub Pages build]
	Pages --> Firebase[Firebase Auth and Firestore]
	Pages --> Collector[Cloud Run collector]
	Collector --> BigQuery[BigQuery analytics]
	Budget[Cloud billing budget] --> Shutdown[Billing shutdown function]
	Shutdown --> Billing[Cloud billing state]
	Admin[Private admin service] --> Firebase
	Admin --> BigQuery
```
