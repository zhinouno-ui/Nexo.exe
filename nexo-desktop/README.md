# Nexo Desktop (Electron)

## Ejecutar en desarrollo

```bash
npm i
npm run dev
```

## Generar `.exe`

```bash
npm run dist
```

## Dónde se guarda la base de datos

Electron guarda `nexo-db.json` dentro de:

- `AppData\\Roaming\\Nexo\\nexo-db.json` (Windows)

Ruta real obtenida con `app.getPath("userData")`.
