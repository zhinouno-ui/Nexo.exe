# Nexo Desktop (Electron)

## Ejecutar en desarrollo

```bash
npm i
npm run dev
```

## Generar `.exe` (Windows)

```bash
npm run dist
```

Se prioriza `nsis` para instalador (auto-update) y también se genera `portable`.

## Dónde se guarda la base de datos

Electron guarda `nexo-db.json` dentro de:

- `AppData\\Roaming\\Nexo\\nexo-db.json` (Windows)

Ruta real obtenida con `app.getPath("userData")`.

## WhatsApp en escritorio

- El botón WhatsApp **siempre abre en navegador externo** del sistema.
- Nunca se abre en popup interno de Electron.
- URLs usadas:
  - `https://wa.me/<E164>?text=<...>`
  - fallback: `https://api.whatsapp.com/send?phone=<E164>&text=<...>`

## Actualizaciones automáticas (GitHub Releases)

- Se usa `electron-updater` con `build.publish.provider = github`.
- La app busca updates al iniciar y también desde el botón visible **Buscar updates** (barra superior) o **Ajustes → Buscar actualizaciones**.
- Al descargar update muestra estado y habilita **Reiniciar y actualizar**.

### Flujo de release

1. Subir versión en `package.json` (ej. `1.1.1`).
2. Ejecutar `npm run dist`.
3. Crear GitHub Release con tag `vX.Y.Z`.
4. Subir artefactos generados en `dist/` (incluyendo `latest.yml` y `.exe`).

> Importante: completar `build.publish.owner` y `build.publish.repo` en `package.json` con tu repo real.

## Rendimiento / imports grandes

- Parseo de contactos movido a **Web Worker** (`renderer/csv-worker.js`) para no bloquear UI.
- Importación con progreso (`Leyendo / Parseando / Integrando`) y opción de cancelar.
- Integración por chunks y guardado con debounce para reducir trabas.
- Ajuste opcional en Ajustes: **Modo debug performance** (métricas `console.time`).
