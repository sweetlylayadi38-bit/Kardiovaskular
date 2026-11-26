# Langit Malam — Modul Kardiovaskular

- Situs statis untuk GitHub Pages, tanpa build step. Jangan tambahkan npm, bundler, atau framework.
- Tema gelap, theme-color `#0d0d0e`. Jangan ganti tema.
- Semua teks paragraf wajib `text-align: justify`.
- Sumatif Anatomi (`#sumatif-anatomi`): pocket book "Anatomi Kardiovaskular" (`anatomi.json`, gambar `p/an1/<lembar>.jpg`, 4 slide per file, diperbesar lewat lightbox `data-zoom="an1|N"`) dan "Latihan Spot Anatomi" (`latanat.json`, skor di localStorage).
- Jangan ubah key localStorage lama (`lm-*`, `lm-*-txt`, `lp-*`, `lp-mode`). Data baru memakai key baru.
- Uji lokal dengan `python3 -m http.server` (JSON dimuat lewat `fetch`, tidak bisa dibuka sebagai `file://`).
