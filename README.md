# Langit Malam — Modul Kardiovaskular

Web belajar Modul Kardiovaskular: slide kuliah beserta penjelasan tiap slide.

- **Sumatif 1** — Kuliah K1–K8, ditambah K9 dan K10 · Antiaritmia (`kuliah.json`; gambar memakai `p/k9`, `p/k10a` lewat field `img`)
- **Sumatif 2** — Kuliah K9–K19 (`kuliah2.json`)
- **Sumatif Integrasi** — Materi praktikum PA, Histologi, Patologi Klinik, Fisiologi (`integrasi.json`)
- **Sitasi Integrasi** — Soal praktikum integrasi 2018–2023 dengan jawaban dan slide pendukung (`sitasi.json`, gambar di `u/si/`)

Buka `index.html` lewat server statis (mis. GitHub Pages atau `python3 -m http.server`); file JSON dimuat dengan `fetch`, jadi tidak bisa dibuka langsung sebagai `file://`.

Gambar slide ada di `p/<id>/<n>.jpg`, tiap file berisi 4 slide bertumpuk.
