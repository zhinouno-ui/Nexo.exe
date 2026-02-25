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

1. Subir versión en `package.json` (ej. `1.1.12`).
2. Commit y push a rama principal.
3. Crear y subir tag de release:
   ```bash
   git tag v1.1.12
   git push origin v1.1.12
   ```
4. GitHub Actions ejecuta `.github/workflows/release.yml` en `windows-latest`, **sincroniza versión desde el tag** (`vX.Y.Z`) y genera el Release automáticamente.
5. Verificar que el Release tenga assets:
   - instalador NSIS (`*.exe`)
   - `latest.yml`
   - `*.blockmap`
   - (opcional) portable `*.exe`
6. Instalar una versión anterior en las PCs y abrir app para detectar la nueva.

> Importante: **subir archivos al repo (commits) NO sirve para auto-update**. `electron-updater` busca metadatos/artefactos en **GitHub Releases**.

> Control de seguridad: el workflow valida que el instalador generado incluya exactamente la versión del tag; si no coincide, falla el release.

> El Release debe incluir sí o sí: instalador `.exe`, `latest.yml` y `*.blockmap` para que `electron-updater` funcione.

## Rendimiento / imports grandes

- Parseo de contactos en **Web Worker** (`renderer/csv-worker.js`) para no bloquear UI.
- Importación con progreso y opción de cancelar.
- Integración por chunks y guardado con debounce.


## Release automatizado con GitHub Actions

- Workflow: `.github/workflows/release.yml`.
- Trigger: push de tags `v*.*.*` (ej. `v1.1.12`).
- Build en `windows-latest` para generar NSIS real para Windows.
- Publica Release con nombre `Nexo vX.Y.Z` y sube automáticamente los assets de `nexo-desktop/dist`.

> Nota: el instalador NSIS es el `*.exe` que produce `dist:win`; el canal portable no se usa para auto-update.


## Rendimiento de carga inicial (desktop)

- La base se precalienta al iniciar y queda en **cache en memoria local del proceso main** (`readDb` cacheado), reduciendo lecturas repetidas de disco.
- El renderer usa bridge seguro (`window.nexoStore`) y los datos se persisten en `AppData` (`nexo-db.json`), no dependen del almacenamiento del navegador.


## Integración de contactos optimizada

- El proceso de importación ahora indexa por teléfono/nombre en memoria (Map) para evitar búsquedas O(n²).
- La etapa "Integrando…" usa chunks adaptativos y cede el hilo periódicamente para que la UI no quede congelada.


## Descarga manual (seguro)

- En **Ajustes** existe la opción para abrir `https://github.com/zhinouno-ui/Nexo.exe/releases/latest` como fallback manual.

## Exportación mejorada

- Se eliminó la exportación XLS para simplificar el flujo y evitar errores de formato.
- VCF exporta en formato vCard 3.0 real con `CRLF`, compatible para importar en celulares.



## Rollback y logs

- Se guarda cache de instaladores descargados en `AppData\Roaming\Nexo\update-cache`.
- Desde Ajustes podés intentar `Volver a versión anterior` (usa instalador cacheado local).
- Log de errores en `AppData\Roaming\Nexo\nexo-error.log`.
- Se bloquea instalación automática cuando un instalador pesa menos de 10MB o más de 500MB (requiere confirmación manual para forzar).

## Checklist del pedido anterior (estado actual)

Resumen: **8/8 implementadas** y reforzadas en esta base.

- [x] Log de errores completo (main + renderer + crashes + unhandled).
- [x] Guardado de instaladores previos para rollback local.
- [x] Botón de rollback en Ajustes.
- [x] Botón de downgrade manual a release estable 1.1.10 en Ajustes.
- [x] Botón failsafe de downgrade fuera del flujo JS principal en pantalla inicial.
- [x] Verificador de update sospechosa por tamaño (`<10MB` o `>500MB`) con confirmación para forzar.
- [x] Limpieza de duplicación visual de storage en estado de guardado.
- [x] Refuerzo de origen: en reimportación de contacto existente se actualiza al origen nuevo y se registra historial de origen por usuario.

