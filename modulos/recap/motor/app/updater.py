"""Auto-update via GitHub Releases.

On app startup we hit the GitHub Releases API and compare `tag_name` against
`app.__version__`. If a newer release exists AND publishes a
`CorteCenas-Setup-*.exe` asset, we prompt the user, download it to a temp
folder, launch the installer detached, and quit — the installer overwrites
Program Files while the app is no longer running.

Silent no-op if:
  - offline / GitHub API unreachable / rate-limited
  - local version >= remote tag
  - the release has no installer asset yet
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

import httpx
from PySide6.QtCore import QThread, Signal
from PySide6.QtWidgets import QApplication, QMessageBox, QProgressDialog, QWidget

from . import __version__
from .ui import quiet

# CHANGE ME: your GitHub "<user>/<repo>" (must be public, or the API returns 404
# for anonymous requests). The updater silently no-ops until this is real.
GITHUB_REPO = "leviclementino1-creator/corte-cenas"

_RELEASES_API = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"


def _parse_version(tag: str) -> tuple[int, ...]:
    """'v1.2.3' or '1.2.3' -> (1, 2, 3). Bad input -> (0,), which loses every compare."""
    cleaned = tag.lstrip("vV").strip()
    parts: list[int] = []
    for chunk in cleaned.split("."):
        try:
            parts.append(int(chunk))
        except ValueError:
            break
    return tuple(parts) if parts else (0,)


def _fetch_latest_release() -> dict | None:
    try:
        r = httpx.get(_RELEASES_API, timeout=5.0, follow_redirects=True)
        if r.status_code != 200:
            return None
        return r.json()
    except Exception:
        return None


# Sentinel: distinguishes "caller didn't prefetch" from "prefetched but the
# network said no" (None). Lets main() do the slow network hit under the
# splash screen and hand the result over without a second request.
_UNFETCHED = object()


def fetch_release() -> dict | None:
    """Network-only half of the update check (no UI). Call it under the
    splash, then pass the result to check_and_offer_update(release=...)."""
    return _fetch_latest_release()


def _find_installer_url(release: dict) -> str | None:
    for asset in release.get("assets", []):
        name = (asset.get("name") or "").lower()
        if name.endswith(".exe") and "setup" in name:
            return asset.get("browser_download_url")
    return None


def _find_delta_url(release: dict) -> str | None:
    """Prefer the small delta zip (~60 MB) over the full setup exe (~2 GB).
    Only present in releases built from v0.1.6+; older releases only ship
    the full setup and we transparently fall back to that."""
    for asset in release.get("assets", []):
        name = (asset.get("name") or "").lower()
        if name.endswith(".zip") and "update" in name:
            return asset.get("browser_download_url")
    return None


class _DownloadThread(QThread):
    progress = Signal(int)
    finished_ok = Signal(str)
    failed = Signal(str)

    def __init__(self, url: str, dest: Path):
        super().__init__()
        self._url = url
        self._dest = dest

    def run(self) -> None:
        try:
            with httpx.stream("GET", self._url, timeout=None, follow_redirects=True) as r:
                total = int(r.headers.get("content-length") or 0)
                downloaded = 0
                with open(self._dest, "wb") as fh:
                    for chunk in r.iter_bytes(chunk_size=128 * 1024):
                        if self.isInterruptionRequested():
                            return
                        fh.write(chunk)
                        downloaded += len(chunk)
                        if total:
                            self.progress.emit(int(downloaded * 100 / total))
            self.finished_ok.emit(str(self._dest))
        except Exception as e:
            self.failed.emit(str(e))


def _find_install_dir() -> Path | None:
    """Return the folder holding the running CorteCenas.exe. Only meaningful
    when frozen — from source we're not installed and there's nothing to
    overwrite."""
    if not getattr(sys, "frozen", False):
        return None
    return Path(sys.executable).resolve().parent


def _find_apply_helper() -> Path | None:
    """Locate apply_update.ps1 that we bundled next to the app."""
    if not getattr(sys, "frozen", False):
        return None
    candidates = [
        Path(sys._MEIPASS) / "apply_update.ps1",
        Path(sys.executable).resolve().parent / "apply_update.ps1",
        Path(sys.executable).resolve().parent / "_internal" / "apply_update.ps1",
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


def _local_deps_fingerprint() -> str | None:
    """sha256 do requirements.txt embarcado NESTA instalação (v0.2.0+)."""
    meipass = getattr(sys, "_MEIPASS", None)
    if not meipass:
        return None
    p = Path(meipass) / "app" / "deps_fingerprint.txt"
    try:
        return p.read_text(encoding="ascii").strip() or None
    except OSError:
        return None


def _zip_deps_fingerprint(zf) -> str | None:
    """sha256 do requirements.txt embarcado no delta zip baixado."""
    for name in ("_internal/app/deps_fingerprint.txt",):
        try:
            return zf.read(name).decode("ascii").strip() or None
        except KeyError:
            continue
        except Exception:
            return None
    return None


def _apply_delta_and_quit(zip_path: str, parent: QWidget | None) -> None:
    """Extract the delta zip, launch the elevated PowerShell helper, quit."""
    import ctypes
    import shutil
    import webbrowser
    import zipfile as _zipfile

    install_dir = _find_install_dir()
    helper = _find_apply_helper()
    if install_dir is None or helper is None:
        raise RuntimeError(
            "Update delta baixado, mas o app está rodando do fonte — "
            "aplique manualmente extraindo o zip em cima da instalação."
        )

    with _zipfile.ZipFile(zip_path) as zf:
        # O delta só carrega o NOSSO código; torch/PySide/etc. ficam como
        # estão. Se o requirements.txt mudou entre a instalação e a release
        # nova, aplicar o delta produziria um app quebrado — recusa e manda
        # pro instalador completo.
        local_fp = _local_deps_fingerprint()
        remote_fp = _zip_deps_fingerprint(zf)
        if local_fp and remote_fp and local_fp != remote_fp:
            print(
                f"[updater] Delta recusado: deps mudaram "
                f"(local {local_fp[:12]}… != release {remote_fp[:12]}…)",
                flush=True,
            )
            quiet.warning(
                parent, "Atualização precisa do instalador completo",
                "Essa versão mudou componentes internos do app, então a "
                "atualização rápida de ~53 MB não é suficiente.\n\n"
                "Vou abrir a página da release — baixe o "
                "CorteCenas-Setup-X.Y.Z.exe (~2 GB) e execute por cima da "
                "instalação atual (configurações e clipes são preservados).",
            )
            webbrowser.open(f"https://github.com/{GITHUB_REPO}/releases/latest")
            return

        staging = Path(zip_path).parent / f"{Path(zip_path).stem}-extract"
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
        staging.mkdir(parents=True)
        zf.extractall(staging)

    # PowerShell command — quoted string args passed via -Command so paths
    # with spaces survive. -ExecutionPolicy Bypass because the helper isn't
    # signed. `runas` verb triggers UAC.
    ps_cmd = (
        f"-NoProfile -ExecutionPolicy Bypass -File \"{helper}\" "
        f"-Source \"{staging}\" -Install \"{install_dir}\""
    )
    hinst = ctypes.windll.shell32.ShellExecuteW(
        None, "runas", "powershell.exe", ps_cmd, None, 0  # SW_HIDE
    )
    if int(hinst) <= 32:
        raise RuntimeError(f"ShellExecute retornou {hinst}")

    app = QApplication.instance()
    if app is not None:
        app.quit()


def check_and_offer_update(
    parent: QWidget | None = None,
    verbose: bool = False,
    release: dict | None | object = _UNFETCHED,
) -> None:
    """Called on app startup (verbose=False, silent no-ops) or from a manual
    'Verificar atualizações' button (verbose=True, shows 'up to date' /
    error dialogs even in the no-update path).

    `release`: pass the dict from fetch_release() to skip the network hit
    (main() prefetches it under the splash screen).

    If an update is applied, quits the QApplication so the installer can run.
    """
    if release is _UNFETCHED:
        release = _fetch_latest_release()
    if not release:
        if verbose:
            quiet.warning(
                parent, "Sem conexão",
                "Não consegui checar a versão mais recente no GitHub.\n"
                "Verifique sua conexão e tente de novo."
            )
        return

    remote_tag = release.get("tag_name") or ""
    if _parse_version(remote_tag) <= _parse_version(__version__):
        if verbose:
            quiet.information(
                parent, "Tudo em dia",
                f"Você já está na versão mais recente: <b>{__version__}</b>."
            )
        return

    installer_url = _find_installer_url(release)
    delta_url = _find_delta_url(release)
    # Prefer the small delta zip when available. Fall back to the full
    # installer if the release doesn't ship one (versions <= 0.1.5) or if
    # applying the delta fails at runtime.
    if not installer_url and not delta_url:
        if verbose:
            quiet.information(
                parent, "Atualização não empacotada",
                f"A versão {remote_tag} está publicada, mas ainda não tem um "
                "instalador anexado. Tente daqui a alguns minutos."
            )
        return

    notes = (release.get("body") or "").strip()
    if len(notes) > 800:
        notes = notes[:800] + "…"

    box = QMessageBox(parent)
    box.setWindowTitle("Nova versão disponível")
    quiet.set_quiet_icon(box, QMessageBox.Icon.Information)
    box.setText(
        f"<b>AnCut HUB {remote_tag}</b> está disponível.<br>"
        f"Você tem <b>{__version__}</b>.<br><br>"
        "Quer atualizar agora?"
    )
    if notes:
        box.setInformativeText("Ver detalhes da versão abaixo.")
        box.setDetailedText(notes)
    box.setStandardButtons(QMessageBox.Yes | QMessageBox.No)
    box.setDefaultButton(QMessageBox.Yes)
    if box.exec() != QMessageBox.Yes:
        return

    # Pick which asset to download. Delta first, fall back to full setup.
    if delta_url:
        dest = Path(tempfile.gettempdir()) / f"CorteCenas-Update-{remote_tag}.zip"
        download_url = delta_url
        is_delta = True
    else:
        dest = Path(tempfile.gettempdir()) / f"CorteCenas-Setup-{remote_tag}.exe"
        download_url = installer_url
        is_delta = False

    progress = QProgressDialog("Baixando atualização...", "Cancelar", 0, 100, parent)
    progress.setWindowTitle("Atualizando AnCut HUB")
    progress.setMinimumDuration(0)
    progress.setAutoClose(False)
    progress.setAutoReset(False)
    progress.setValue(0)

    thread = _DownloadThread(download_url, dest)

    def _launch_and_quit(path: str) -> None:
        progress.close()
        try:
            if sys.platform == "win32":
                if is_delta:
                    _apply_delta_and_quit(path, parent)
                    return
                # Full-installer path: ShellExecuteW with lpVerb="runas" so
                # the UAC prompt shows even from an unelevated caller. The
                # Inno flags run the installer without wizard UI and auto-
                # restart the app after.
                import ctypes
                args = (
                    "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART "
                    "/RESTARTAPPLICATIONS /CLOSEAPPLICATIONS"
                )
                hinst = ctypes.windll.shell32.ShellExecuteW(
                    None, "runas", path, args, None, 1  # SW_SHOWNORMAL
                )
                if int(hinst) <= 32:
                    raise RuntimeError(f"ShellExecute retornou {hinst}")
            else:
                subprocess.Popen([path], close_fds=True)
        except Exception as e:
            quiet.warning(
                parent, "Erro ao iniciar instalador",
                f"{e}\n\nO instalador foi baixado em:\n{path}\n\n"
                "Você pode dar dois cliques nele manualmente pra atualizar."
            )
            return
        app = QApplication.instance()
        if app is not None:
            app.quit()

    def _show_error(err: str) -> None:
        progress.close()
        quiet.warning(
            parent, "Erro ao atualizar",
            f"Não foi possível baixar a atualização:\n\n{err}\n\n"
            "Tenta de novo em alguns minutos ou baixa manualmente do GitHub."
        )

    thread.progress.connect(progress.setValue)
    thread.finished_ok.connect(_launch_and_quit)
    thread.failed.connect(_show_error)
    progress.canceled.connect(thread.requestInterruption)

    thread.start()
    progress.exec()

    # If user canceled mid-download, give the thread a moment to bail out cleanly.
    if thread.isRunning():
        thread.requestInterruption()
        thread.wait(2000)
