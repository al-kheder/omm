[English](./README.md) | [Türkçe](./README.tr.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [中文](./README.zh.md)

> Bu belge İngilizce README'nin Türkçe çevirisidir. Bazı terimler bilinçli olarak İngilizce bırakılmıştır.

<p align="center">
  <img src="./docs/logo.jpg" alt="omm logo" width="80"/>
</p>

<h1 align="center">Oh-my-mermaid</h1>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"/></a>
</p>

<p align="center">
  Yapay zekâ kodu saniyeler içinde yazıyor. İnsanların o kodu anlaması ise saatler sürüyor.<br/>
  O an anlamayı es geçerseniz, kod tabanı kısa sürede bir kara kutuya dönüşüyor — üstelik sizin için bile.<br/><br/>
  <strong>omm bu boşluğu kapatır — insanlar için, yapay zekâ destekli mimari dokümantasyon üretir.</strong>
</p>

---

## Hızlı Başlangıç

Node.js 18 veya üzeri ve Git gereklidir.

**1. CLI'ı kurun ve yetenekleri kaydedin.** Aşağıdaki komutu terminale yapıştırın:

```bash
npm install -g github:al-kheder/omm && omm setup
```

npm 12 veya üzerinde kurulum komutuna `--allow-git=all` ekleyin; npm 12 varsayılan olarak GitHub'dan kurulumu engeller.

`omm setup`, bulduğu her AI aracına yetenekleri kaydeder (bkz. [Desteklenen AI Araçları](#desteklenen-ai-araçları)). Claude Code'u yalnızca `claude` komutu kuruluysa bulur. Yalnızca VS Code eklentisini veya masaüstü uygulamasını kullanıyorsanız, eklentiyi Claude Code içinden ekleyin:

```
/plugin marketplace add al-kheder/omm
/plugin install oh-my-mermaid@al-kheder-omm
```

**2. Kod tabanınızı tarayın.** AI kodlama aracınızı projenizde açın ve çalıştırın:

```
/omm-scan
```

Claude Code'da yetenek `/oh-my-mermaid:omm-scan` olarak görünür. Tarama, belgeleri projenizdeki `.omm/` klasörüne yazar.

**3. Sonucu görüntüleyin.** Proje klasörünüzde çalıştırın:

```bash
omm view
```

Ardından http://localhost:3000 adresini açın. Başka bir port için `--port <n>` kullanın. Görüntüleyici yalnızca kendi bilgisayarınızdan gelen bağlantıları kabul eder ve `.omm/` değiştikçe canlı olarak güncellenir. Araç çubuğunda **clean** dosya yollarını gizler, **svg** / **png** ise seçili diyagramı indirir; örneğin bir müşteri sunumuna eklemek için. **mono | color** siyah-beyaz görünüm ile her öğenin ne olduğunu gösteren renkler (başlangıç/bitiş, karar, veri deposu …) arasında geçiş yapar.

## Örnek

> omm kendi kod tabanını taradı. Ortaya çıkan sonuç şöyle.

<table><tr>
<td width="50%"><img src="./docs/screenshot.png" alt="omm viewer"/></td>
<td width="50%"><img src="./docs/demo.gif" alt="omm scan demo"/></td>
</tr></table>

## Nasıl Çalışır?

Yapay zekâ kod tabanını analiz eder ve **perspective**'ler üretir — yani mimariye farklı açılardan bakan katmanlar (yapı, veri akışı, entegrasyonlar vb.). Her perspective içinde bir Mermaid diyagramı ve ilgili dokümantasyon alanları bulunur.

Her düğüm **özyinelemeli olarak analiz edilir**. Karmaşık düğümler, kendi diyagramlarına sahip iç içe alt elementlere dönüşür. Daha basit olanlar ise yaprak düğüm olarak kalır. Dosya sistemi de bu ağacı doğrudan yansıtır:

```
.omm/
├── overall-architecture/           ← perspective
│   ├── description.md
│   ├── diagram.mmd
│   ├── context.md
│   ├── main-process/               ← iç içe element
│   │   ├── description.md
│   │   ├── diagram.mmd
│   │   └── auth-service/           ← daha derin iç içe yapı
│   │       └── ...
│   └── renderer/
│       └── ...
├── data-flow/
└── external-integrations/
```

Görüntüleyici, bu iç içe yapıyı dosya sistemine bakarak otomatik algılar. Alt öğeleri olan elementler genişletilebilir grup olarak, diğerleri ise düğüm olarak gösterilir.

Her element en fazla 7 alan taşıyabilir: `description`, `diagram`, `context`, `constraint`, `concern`, `todo`, `note`.

Diyagramlar akış şemaları (`graph` / `flowchart`), veritabanı şemaları gibi veri modelleri için ER diyagramları (`erDiagram`) bir istek ya da protokoldeki çağrı sırası için sıra diyagramları (`sequenceDiagram`) veya yaşam döngüleri ve durum makineleri için durum diyagramlarıdır (`stateDiagram-v2`). Dördü de `omm validate` ile doğrulanır ve görüntüleyicide çizilir. Akış şemaları teknik olmayan okuyucular için süreç diyagramı olarak da kullanılabilir: başlangıç/bitiş, adımlar, evet/hayır kararları, girdi/çıktı, belgeler, alt süreçler ve her rol için bir şerit (`subgraph`).

## CLI

```bash
omm setup                          # Yetenekleri AI araçlarına kaydet
omm view                           # Etkileşimli görüntüleyiciyi aç
omm config language ko             # İçerik dilini ayarla
omm update                         # En güncel sürüme geç
```

Tüm komutları görmek için `omm help` çalıştırın.

## Yetenekler

Yetenekler, **AI kodlama aracınızın içinde** çalıştırdığınız komutlardır (terminalde değil). `/` ile başlarlar.

| Yetenek | Açıklama |
| --- | --- |
| `/omm-scan` | Kod tabanını analiz eder → mimari dokümantasyon üretir |
| `/omm-view` | Mimari görüntüleyiciyi tarayıcıda açar |
| `/omm-push` | Giriş + bağlama + buluta gönderme işlemini tek adımda tamamlar |

## Bulut (isteğe bağlı)

Her şey yerel olarak çalışır; hesap veya sunucu gerekmez. `login`, `link`, `push` ve `pull` komutları yalnızca uyumlu bir sunucu belirttiğinizde çalışır:

```bash
export OMM_API_URL=https://your-server.example
omm login && omm link && omm push
```

Varsayılan olarak yapılandırılmış bir sunucu yoktur.

## Desteklenen AI Araçları

| Platform | Kurulum |
| --- | --- |
| Claude Code | `omm setup claude` |
| Codex | `omm setup codex` |
| Cursor | `omm setup cursor` |
| OpenClaw | `omm setup openclaw` |
| Antigravity | `omm setup antigravity` |

`omm setup` komutu, yüklü tüm araçları otomatik olarak algılar ve yapılandırır.

## Yol Haritası

Bkz. [docs/ROADMAP.md](./docs/ROADMAP.md).

## Geliştirme ve Katkı

```bash
git clone https://github.com/al-kheder/omm.git
cd omm
corepack enable   # provides the pinned pnpm version
pnpm install && pnpm build
pnpm test
```

Issue ve PR'lar memnuniyetle karşılanır. Lütfen [Conventional Commits](https://www.conventionalcommits.org/) kullanın.

## Lisans

[MIT](./LICENSE)
