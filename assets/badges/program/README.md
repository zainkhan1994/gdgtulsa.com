# Developer Program badge artwork

Badge images for the organizer page badge wall go here.

Save each as `<slug>.png` (square, ideally 192x192 or larger) where `<slug>`
is the `s` value for that badge in `assets/organizer-badges.js`, then add the
slug to the `WITH_ART` array at the top of that file.

Badges not listed in `WITH_ART` render a neutral GDG placeholder tile, so no
request is made for artwork that isn't committed.

Example:
    assets/badges/program/google-cloud-innovator.png
    -> WITH_ART = ['google-cloud-innovator'];
