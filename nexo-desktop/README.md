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
- y manualmente desde **Ajustes → Buscar actualizaciones**, barra superior y **pantalla inicial** (antes de cargar contactos).

Muestra estados:

- Buscando actualizaciones,
- Descargando `%`,
- Actualización lista para reiniciar.

### Configuración requerida

`package.json` usa `build.publish` con GitHub:

- `owner: zhinouno-ui`
- `repo: Nexo.exe`

Antes de construir/publicar, editar esos valores con tu owner/repo real de GitHub en `package.json`.

## Flujo correcto de publicación (OBLIGATORIO para updater)

1. Subir versión en `package.json` (ej. `1.1.9`).
2. Commit y push a rama principal.
3. Crear y subir tag de release:
   ```bash
   git tag v1.1.9
   git push origin v1.1.9
   ```
4. GitHub Actions ejecuta `.github/workflows/release.yml` en `windows-latest` y genera el Release automáticamente.
5. Verificar que el Release tenga assets:
   - instalador NSIS (`*.exe`)
   - `latest.yml`
   - `*.blockmap`
   - (opcional) portable `*.exe`
6. Instalar una versión anterior en las PCs y abrir app para detectar la nueva.

> Importante: **subir archivos al repo (commits) NO sirve para auto-update**. `electron-updater` busca metadatos/artefactos en **GitHub Releases**.

## Rendimiento / imports grandes

- Parseo de contactos en **Web Worker** (`renderer/csv-worker.js`) para no bloquear UI.
- Importación con progreso y opción de cancelar.
- Integración por chunks y guardado con debounce.


## Release automatizado con GitHub Actions

- Workflow: `.github/workflows/release.yml`.
- Trigger: push de tags `v*.*.*` (ej. `v1.1.9`).
- Build en `windows-latest` para generar NSIS real para Windows.
- Publica Release con nombre `Nexo vX.Y.Z` y sube automáticamente los assets de `nexo-desktop/dist`.

> Nota: el instalador NSIS es el `*.exe` que produce `dist:win`; el canal portable no se usa para auto-update.


## Rendimiento de carga inicial (desktop)

- La base se precalienta al iniciar y queda en **cache en memoria local del proceso main** (`readDb` cacheado), reduciendo lecturas repetidas de disco.
- El renderer usa bridge seguro (`window.nexoStore`) y los datos se persisten en `AppData` (`nexo-db.json`), no dependen del almacenamiento del navegador.


## Integración de contactos optimizada

- El proceso de importación ahora indexa por teléfono/nombre en memoria (Map) para evitar búsquedas O(n²).
- La etapa "Integrando…" usa chunks adaptativos y cede el hilo periódicamente para que la UI no quede congelada.
