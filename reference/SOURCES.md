# Reference sources

Openly licensed real-fly photos and video for the deskfly sprite. All licenses read from
each file's own Commons description page on 2026-08-17. Attribution required for the
CC BY and CC BY-SA items; the rest are CC0 or public domain.

## raw/dorsal-fly-back-usgs-biml-pd.jpg
- Source page: https://commons.wikimedia.org/wiki/File:Fly,-back_2012-07-26-16.41.49-ZS-PMax_(7733402690).jpg
- File URL: https://upload.wikimedia.org/wikipedia/commons/d/d7/Fly%2C-back_2012-07-26-16.41.49-ZS-PMax_%287733402690%29.jpg
- Author: USGS Native Bee Inventory and Monitoring Laboratory (Flickr)
- License: Public domain (US federal government work)
- Straight top-down "back" shot of a fly specimen, focus-stacked (Zerene ZS PMax), dark background, 4493x2995. Species not identified on the page.

## raw/musca-domestica-hk-01-cc0.jpg
- Source page: https://commons.wikimedia.org/wiki/File:HK_house_fly_%E8%92%BC%E8%A0%85_Musca_domestica_August_2024_R12S_01.jpg
- File URL: https://upload.wikimedia.org/wikipedia/commons/a/ab/HK_house_fly_%E8%92%BC%E8%A0%85_Musca_domestica_August_2024_R12S_01.jpg
- Author: Spidamin 888 Simnonz (Wikimedia Commons user)
- License: CC0
- Live Musca domestica, Hong Kong, natural background, 4000x3000. Confirmed housefly for body color and markings; view angle not stated on the page.

## raw/idiohelina-nmnh-pinned-dorsal-cc0.jpg
- Source page: https://commons.wikimedia.org/wiki/File:Idiohelina_nubeculosa_nmnhentomology_9149709_NMNH-usnment01071655_idiohelina_nubeculosa_dorsal.jpg
- File URL: https://upload.wikimedia.org/wikipedia/commons/7/76/Idiohelina_nubeculosa_nmnhentomology_9149709_NMNH-usnment01071655_idiohelina_nubeculosa_dorsal.jpg
- Author: Smithsonian National Museum of Natural History, Entomology Dept.
- License: CC0
- Pinned muscid fly (Idiohelina nubeculosa), dorsal habitus, focus-stacked (StackShot rig per EXIF), plain background, 4032x3024. Wings-visible pinned-specimen slot.

## raw/sarcophaga-bullata-dorsal-wings-pd.jpg
- Source page: https://commons.wikimedia.org/wiki/File:Sarcophaga_wings.jpg
- File URL: https://upload.wikimedia.org/wikipedia/commons/b/b8/Sarcophaga_wings.jpg
- Author: Commons user 0'.12.1.0.N
- License: Public domain (released by author)
- Dorsal side of a flesh fly (Sarcophaga bullata) with wings prominent, 1000x641. Small backup for the wings-out dorsal view.

## raw/housefly-wing-isolated-pd.jpg
- Source page: https://commons.wikimedia.org/wiki/File:Housefly_Wing_01_(42027097055).jpg
- File URL: https://upload.wikimedia.org/wikipedia/commons/8/8c/Housefly_Wing_01_%2842027097055%29.jpg
- Author: Randolph Black (Flickr)
- License: Public domain (per Commons file page)
- Macro of an isolated housefly wing showing membrane and veins, 3435x2748.

## raw/druid-fly-grooming-ccby2.webm
- Source page: https://commons.wikimedia.org/wiki/File:Druid_fly_(Sobarocephala_flava)_grooming.webm
- File URL: https://upload.wikimedia.org/wikipedia/commons/7/78/Druid_fly_%28Sobarocephala_flava%29_grooming.webm
- Author: Katja Schulz
- License: CC BY 2.0 (credit Katja Schulz)
- 1920x1080 stabilized video of a fly grooming (leg and wing wipes), close-up. 11.3 MB.

## raw/sarcophaga-live-ccbysa3.ogv
- Source page: https://commons.wikimedia.org/wiki/File:Sarcophaga_spec.ogv
- File URL: https://upload.wikimedia.org/wikipedia/commons/a/a4/Sarcophaga_spec.ogv
- Author: Pristurus (Wikimedia Commons user)
- License: CC BY-SA 3.0 (credit Pristurus, share-alike)
- 1023x576 video of a live flesh fly (Sarcophaga sp., calyptrate like the housefly) on a surface. 3.4 MB. CC BY-SA taken because no CC0 or CC BY video of a live calyptrate fly was found on Commons.

## raw/musca-autumnalis-regina-ccbysa4.jpg
- Source page: https://commons.wikimedia.org/wiki/File:Musca_autumnalis_De_Geer_1776_%E2%99%80.jpg
- File URL: https://upload.wikimedia.org/wikipedia/commons/1/19/Musca_autumnalis_De_Geer_1776_%E2%99%80.jpg
- Author: Elena Regina
- License: CC BY-SA 4.0 (credit Elena Regina, share-alike)
- Musca autumnalis specimen, lateral view, 3840x2195. Fetched as a candidate rest-pose
  source; turned out to be a side view, kept for color reference only.

## Sprites built from these photos

`sprites/body.png` and `sprites/head.png` are cut from
raw/dorsal-fly-back-usgs-biml-pd.jpg (public domain, USGS BIML): the clean half of the
specimen mirrored across the body axis (scripts/make-sprites.js + sprites.config.json).
`sprites/side.png` is cut from raw/musca-autumnalis-regina-ccbysa4.jpg and is therefore
CC BY-SA 4.0, credit Elena Regina, share-alike applies to that file. Top-view wings and
legs are drawn procedurally at runtime.
