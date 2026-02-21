# Nexo Desktop (Electron)

## Ejecutar en desarrollo

```bash
npm i
npm run dev
```

## Generar instaladores

```bash
npm run dist
```

- Canal principal para auto-update: **NSIS Setup**.
- `portable` puede generarse, pero **no debe usarse como canal de auto-actualización**.

## Dónde se guarda la base de datos

Electron guarda `nexo-db.json` dentro de:

- `AppData\\Roaming\\Nexo\\nexo-db.json` (Windows)

Ruta real obtenida con `app.getPath("userData")`.

## WhatsApp en escritorio

- El botón WhatsApp **siempre abre en navegador externo** del sistema.
- Nunca se abre en popup interno de Electron.

## Auto-update real con GitHub Releases (electron-updater)

La app chequea updates:

- al iniciar (solo en app empaquetada/instalada),
- y manualmente desde **Ajustes → Buscar actualizaciones** (y botón visible de barra superior).

Muestra estados:

- Buscando actualizaciones,
- Descargando `%`,
- Actualización lista para reiniciar.

### Configuración requerida

`package.json` usa `build.publish` con GitHub:

- `owner: REEMPLAZAR_OWNER`
- `repo: Nexo.exe`

Antes de construir/publicar, editar esos valores con tu owner/repo real de GitHub en `package.json`.

## Flujo correcto de publicación (OBLIGATORIO para updater)

1. Subir versión en `package.json` (ej. `1.1.2`).
2. Ejecutar `npm run dist`.
3. Crear GitHub Release con tag `vX.Y.Z`.
4. Adjuntar assets de `dist/`:
   - `Nexo Setup ... .exe` (NSIS)
   - `latest.yml`
   - `.blockmap` asociado
5. Instalar una versión anterior en las PCs y abrir app para que detecte la nueva.

> Importante: **subir archivos al repo (commits) NO sirve para auto-update**. `electron-updater` busca metadatos/artefactos en **GitHub Releases**.

## Rendimiento / imports grandes

- Parseo de contactos en **Web Worker** (`renderer/csv-worker.js`) para no bloquear UI.
- Importación con progreso y opción de cancelar.
- Integración por chunks y guardado con debounce.
