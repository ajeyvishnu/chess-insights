# Chess Insights

A personal dashboard of Chess.com games: results, openings, clock use, calendar patterns and ratings.
Pure HTML, CSS and JavaScript, no build step and no external services.

## Files
- `index.html`: page shell
- `app.js`, `styles.css`: the dashboard, adapted from the Tableau data app with standalone data loading
- `data-loader.js`: loads the CSVs in `data/` and presents them to `app.js`
- `data/chess_blender_analysis.csv`: one row per game
- `data/chess_move_timing.csv`: one row per game, move-number phase, check flag and low-clock flag

## Run locally
Browsers block `fetch` from `file://`, so serve the folder:

    python -m http.server 8000

then open http://localhost:8000

## Publish on GitHub Pages
Repository Settings > Pages > Build and deployment > Deploy from a branch > `main` / `(root)` > Save.

## Refresh the data
Replace the two CSV files in `data/` (same column names) and commit.

## Embed in Tableau Public
In a Tableau Public dashboard, drag a Web Page object onto the canvas and enter the GitHub Pages HTTPS URL.

## Data note
The data files are public once this repository is public. Opponent usernames are blank; game links point to public Chess.com games.

Snapshot: January 1, 2024 through November 17, 2026 (Eastern). 9,650 games, 836 active days,
4,697 wins, 4,561 losses and 392 draws. 42,636 timing groups link to games through game_url.
Win rate includes draws in the denominator. Timing averages are weighted by timed_moves.
Phases are move-number bands (1–10, 11–30, 31+), not engine-derived game phases.
Clock use is estimated from available PGN clock annotations; no engine accuracy or blunder scores are inferred.

Design references: Ajay Vishnu Addala's 2024 Tableau Chess Wrapped and Chess.com Insights.
The GitHub Pages / Tableau Web Page embedding approach was informed by Jeb Besecker's Data Defense:
https://github.com/JebBesecker03/Data-Defense . This app retains Ajay's own chess implementation.
