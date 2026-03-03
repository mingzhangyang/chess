# Phase D2 Head-to-Head Quantification (TS vs stockfish.wasm)

- Date: 2026-03-03T20:05:38.992Z
- Platform: linux 6.6.87.2-microsoft-standard-WSL2
- CPU: AMD Ryzen 7 4700U with Radeon Graphics (8 cores)
- Move time per side: 120ms
- Max plies per game: 50
- Openings used: 6 / 6 (each played with color swap)
- Rounds per opening: 8
- Total games: 96

## Match Result

- stockfish.wasm wins: 10
- TypeScript engine wins: 3
- Draws: 83
- stockfish score: 53.65%
- Elo estimate (stockfish - TS): 25.4
- Approx 95% CI: [-44.2, 97.1]

## Performance Summary

- TS avg move time: 1174.20ms
- stockfish avg move time: 132.50ms
- TS avg nodes/move: 43
- TS avg qNodes/move: 278

## Game Ledger

| Game | Opening | stockfish color | Result | Reason | Ply | TS moves | SF moves | TS time(ms) | SF time(ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | Start Position | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 25 | 25 | 14403 | 3313 |
| G2 | Start Position | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 25 | 25 | 12712 | 3294 |
| G3 | Start Position | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 25 | 25 | 75475 | 3307 |
| G4 | Start Position | b | 1-0 | checkmate | 35 | 18 | 17 | 25811 | 2087 |
| G5 | Start Position | w | 0-1 | checkmate | 46 | 23 | 23 | 9941 | 2947 |
| G6 | Start Position | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 25 | 25 | 16405 | 3304 |
| G7 | Start Position | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 25 | 25 | 16616 | 3299 |
| G8 | Start Position | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 25 | 25 | 16563 | 3291 |
| G9 | Start Position | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 25 | 25 | 18136 | 3297 |
| G10 | Start Position | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 25 | 25 | 9519 | 3293 |
| G11 | Start Position | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 25 | 25 | 31302 | 3320 |
| G12 | Start Position | b | 1-0 | checkmate | 39 | 20 | 19 | 8460 | 2350 |
| G13 | Start Position | w | 1-0 | checkmate | 47 | 23 | 24 | 30374 | 3163 |
| G14 | Start Position | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 25 | 25 | 12795 | 3298 |
| G15 | Start Position | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 25 | 25 | 24434 | 3299 |
| G16 | Start Position | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 25 | 25 | 13587 | 3307 |
| G17 | Ruy Lopez | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 41204 | 2904 |
| G18 | Ruy Lopez | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 12776 | 2912 |
| G19 | Ruy Lopez | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 15236 | 2904 |
| G20 | Ruy Lopez | b | 0-1 | checkmate | 24 | 9 | 9 | 5352 | 1183 |
| G21 | Ruy Lopez | w | 1-0 | checkmate | 37 | 15 | 16 | 23535 | 2108 |
| G22 | Ruy Lopez | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 32139 | 2900 |
| G23 | Ruy Lopez | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 12363 | 2906 |
| G24 | Ruy Lopez | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 35422 | 2911 |
| G25 | Ruy Lopez | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 32647 | 2898 |
| G26 | Ruy Lopez | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 19905 | 2895 |
| G27 | Ruy Lopez | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 31337 | 2917 |
| G28 | Ruy Lopez | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 12748 | 2905 |
| G29 | Ruy Lopez | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 31536 | 2902 |
| G30 | Ruy Lopez | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 13615 | 2913 |
| G31 | Ruy Lopez | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 17650 | 2900 |
| G32 | Ruy Lopez | b | 0-1 | checkmate | 46 | 20 | 20 | 19529 | 2754 |
| G33 | Queen Gambit Declined | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 41146 | 2912 |
| G34 | Queen Gambit Declined | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 38924 | 2898 |
| G35 | Queen Gambit Declined | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 26625 | 2908 |
| G36 | Queen Gambit Declined | b | 0-1 | checkmate | 50 | 22 | 22 | 9361 | 2907 |
| G37 | Queen Gambit Declined | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 36969 | 2920 |
| G38 | Queen Gambit Declined | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 9778 | 2912 |
| G39 | Queen Gambit Declined | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 28570 | 2910 |
| G40 | Queen Gambit Declined | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 12513 | 2903 |
| G41 | Queen Gambit Declined | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 10326 | 2901 |
| G42 | Queen Gambit Declined | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 29180 | 2898 |
| G43 | Queen Gambit Declined | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 16190 | 2914 |
| G44 | Queen Gambit Declined | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 19803 | 2925 |
| G45 | Queen Gambit Declined | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 19730 | 2914 |
| G46 | Queen Gambit Declined | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 49922 | 2930 |
| G47 | Queen Gambit Declined | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 37680 | 2907 |
| G48 | Queen Gambit Declined | b | 0-1 | checkmate | 46 | 20 | 20 | 32816 | 2637 |
| G49 | Sicilian Najdorf Setup | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 21 | 21 | 29359 | 2778 |
| G50 | Sicilian Najdorf Setup | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 21 | 21 | 11532 | 2771 |
| G51 | Sicilian Najdorf Setup | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 21 | 21 | 90168 | 2770 |
| G52 | Sicilian Najdorf Setup | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 21 | 21 | 21168 | 2762 |
| G53 | Sicilian Najdorf Setup | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 21 | 21 | 17225 | 2764 |
| G54 | Sicilian Najdorf Setup | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 21 | 21 | 12688 | 2813 |
| G55 | Sicilian Najdorf Setup | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 21 | 21 | 41964 | 2798 |
| G56 | Sicilian Najdorf Setup | b | 0-1 | checkmate | 36 | 14 | 14 | 17143 | 1851 |
| G57 | Sicilian Najdorf Setup | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 21 | 21 | 26824 | 2792 |
| G58 | Sicilian Najdorf Setup | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 21 | 21 | 24414 | 2778 |
| G59 | Sicilian Najdorf Setup | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 21 | 21 | 35418 | 2806 |
| G60 | Sicilian Najdorf Setup | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 21 | 21 | 21191 | 2776 |
| G61 | Sicilian Najdorf Setup | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 21 | 21 | 27251 | 2777 |
| G62 | Sicilian Najdorf Setup | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 21 | 21 | 45337 | 2789 |
| G63 | Sicilian Najdorf Setup | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 21 | 21 | 37960 | 2783 |
| G64 | Sicilian Najdorf Setup | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 21 | 21 | 16694 | 2785 |
| G65 | English Four Knights | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 18613 | 2913 |
| G66 | English Four Knights | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 35365 | 2943 |
| G67 | English Four Knights | w | 1-0 | checkmate | 43 | 18 | 19 | 26331 | 2532 |
| G68 | English Four Knights | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 24177 | 2945 |
| G69 | English Four Knights | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 36676 | 2930 |
| G70 | English Four Knights | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 14611 | 2924 |
| G71 | English Four Knights | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 40276 | 2966 |
| G72 | English Four Knights | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 14666 | 2945 |
| G73 | English Four Knights | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 13559 | 2968 |
| G74 | English Four Knights | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 17756 | 2934 |
| G75 | English Four Knights | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 41198 | 2933 |
| G76 | English Four Knights | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 39070 | 2946 |
| G77 | English Four Knights | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 9951 | 2924 |
| G78 | English Four Knights | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 36281 | 2924 |
| G79 | English Four Knights | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 14013 | 2930 |
| G80 | English Four Knights | b | 0-1 | checkmate | 30 | 12 | 12 | 8929 | 1605 |
| G81 | King Indian Structure | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 58806 | 2952 |
| G82 | King Indian Structure | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 12304 | 2951 |
| G83 | King Indian Structure | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 46901 | 2950 |
| G84 | King Indian Structure | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 20867 | 2929 |
| G85 | King Indian Structure | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 24813 | 2917 |
| G86 | King Indian Structure | b | 0-1 | checkmate | 50 | 22 | 22 | 33678 | 2940 |
| G87 | King Indian Structure | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 28399 | 2946 |
| G88 | King Indian Structure | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 12170 | 2945 |
| G89 | King Indian Structure | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 23444 | 2957 |
| G90 | King Indian Structure | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 18152 | 2927 |
| G91 | King Indian Structure | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 41335 | 2959 |
| G92 | King Indian Structure | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 27414 | 2964 |
| G93 | King Indian Structure | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 29218 | 2934 |
| G94 | King Indian Structure | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 23496 | 2940 |
| G95 | King Indian Structure | w | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 26332 | 2927 |
| G96 | King Indian Structure | b | 1/2-1/2 | adjudicated-max-plies-50 | 50 | 22 | 22 | 29423 | 2914 |

## Notes

- This is an in-process Node benchmark using the same machine for both engines.
- TS randomness/book were disabled to keep results reproducible.
- stockfish.wasm asset loading in Node uses local fetch patching for package file paths.
