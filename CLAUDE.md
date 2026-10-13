# BlockStrike

Браузърен multiplayer FPS. **Визията е voxel/пикселна (Minecraft), механиките следват Counter-Strike 2.**
Когато нещо не е уточнено, питай „как е в CS2?“ и го направи така (скорости, икономика, щети, правила на рунда, поведение на бомбата).

## Правила, които не се нарушават

1. **Сървърът е авторитетен** за попадения, щети, патрони, пари, купуване, гранати, бомба и състояние на рунда. Клиентът само предвижда собственото си движение; сървърът валидира скорост и колизии.
2. Клиентът изпраща **входни данни** (позиция/ъгли, „стрелям“, „презареждам“), никога резултати (щети, убийства). Откатът (spray pattern) и неточността се смятат на сървъра със същите формули от `shared/weapons.js`.
3. Всички клавиши се четат през `event.code` (`KeyW`, `KeyR`, `KeyF`…), никога `event.key` – за да работят и на българска клавиатура.
4. Всички звуци са процедурни (Web Audio API), всички текстури и модели – процедурни (canvas / воксели). Няма външни медийни файлове.
5. Блоковете, картите и оръжията са данни (`shared/`, `server/maps/*.json`); не ги дублирай в клиента и сървъра.
6. Не чупи мрежовия протокол без да обновиш и двете страни и `test/smoke.mjs`.

## Структура

```
server/index.js        Express + Socket.io: стаи, рундове, икономика, оръжия, ножове, hitscan, гранати, бомба (носител/падане/defuse kit)
server/maps/*.json     карти (ops = кутии от блокове; env; spawns; sites). mine/snow/harbor се генерират от tools/genmaps.mjs
shared/world.js        блокове (BLOCK/DEFS), воксел свят, колизии, лъчево обхождане
shared/weapons.js      оръжия, ножове, recoilAt, spreadFor, движение (MOVE), икономика (CFG), магазин (ITEMS)
public/client.js       главен клиент: мрежа, вход, физика на играча (64 Hz), HUD, цикъл на рендиране
public/textures.js     процедурни 64x64 текстури + атлас (с extrude рамка срещу процепи при mip)
public/mesher.js       чънкове 16x16, осветление (небе + факли), ambient occlusion
public/audio.js        Web Audio: 3D звуци (PannerNode), стъпки по повърхности, сила на звука
public/voxmodel.js     воксел чертежи на оръжия/ножове/ръце + построител на геометрия (LOD step)
public/skindata.js     процедурни скинове (функции на воксел координати)
public/viewmodel.js    анимации от първо лице: вадене, откат, презареждане, inspect, удари с нож (отделна сцена)
public/skins.js        меню за скинове с 3D преглед
public/radar.js        радар (съотборници, носител/паднала/заложена бомба)
tools/genmaps.mjs      генератор на картите; tools/validate-maps.mjs – проверка; tools/bot.mjs – тестов бот
test/smoke.mjs         автоматичен тест на сървъра (BS_TEST=1: ускорени таймери + телепорт `dbgTp`)
```

Мерки: 1 блок = 1 метър; играч 1.8 м (CS: 72 единици). CS единици → метри: делим на 40.
Воксел модели: 1 воксел = 1 см; оси +x дясно, +y горе, **-z напред**.

## Пускане

```bash
npm install
npm start            # http://localhost:3000
npm test             # smoke тест на сървъра (порт 3999)
npm run validate     # проверка на картите
npm run maps         # прегенерира mine/snow/harbor
npm run bot -- СТАЯ  # тестов бот
```

## Деплой (Render)

GitHub репозитори → Render **New → Blueprint** (`render.yaml`) или Web Service:
Build `npm install`, Start `npm start`, Health check `/healthz`. Сървърът слуша `process.env.PORT`.
Състоянието на стаите е в паметта → **една инстанция**. Безплатният план заспива при неактивност.

## Конвенции

- Език на интерфейса и коментарите: български.
- Нов блок: `shared/world.js` (`DEFS`) + плочки в `public/textures.js` (`TILES` и `BLOCK_TILES`).
- Ново оръжие: данни в `shared/weapons.js` + чертеж в `public/voxmodel.js` (`BP`) + базова поза и анимации във `public/viewmodel.js` + магазин (`ITEMS`) + звук в `public/audio.js`.
- Нова карта: JSON или функция в `tools/genmaps.mjs`, после `npm run validate`.
- След промяна: `npm test` и `npm run validate`; провери и в браузър.
- Отладка в конзолата на браузъра: `__S` (състояние), `__socket`, `__vm` (viewmodel), `__renderer`; `__S.debugCam = {x,y,z,yaw,pitch}` и `__S.noSend = true` за свободна камера без изпращане на позиция.
