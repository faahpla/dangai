"""QMessageBox sem o som de alerta do Windows.

`QMessageBox.showEvent` toca o MessageBeep do sistema sempre que um ícone
padrão (Information/Warning/Critical/Question) foi setado via `setIcon`.
Setar o MESMO desenho via `setIconPixmap` pula o beep — visual idêntico,
zero barulho. Todo diálogo do app deve passar por aqui.
"""
from __future__ import annotations

from PySide6.QtWidgets import QApplication, QMessageBox, QStyle

_PIXMAPS = {
    QMessageBox.Icon.Information: QStyle.StandardPixmap.SP_MessageBoxInformation,
    QMessageBox.Icon.Warning: QStyle.StandardPixmap.SP_MessageBoxWarning,
    QMessageBox.Icon.Critical: QStyle.StandardPixmap.SP_MessageBoxCritical,
    QMessageBox.Icon.Question: QStyle.StandardPixmap.SP_MessageBoxQuestion,
}


def set_quiet_icon(box: QMessageBox, icon: QMessageBox.Icon) -> None:
    """Aplica o visual do ícone padrão sem acionar o beep do showEvent."""
    sp = _PIXMAPS.get(icon)
    if sp is None:
        return
    style = box.style() or QApplication.style()
    box.setIconPixmap(style.standardIcon(sp).pixmap(32, 32))


def _show(parent, icon, title, text, buttons, default) -> QMessageBox.StandardButton:
    box = QMessageBox(parent)
    box.setWindowTitle(title)
    box.setText(text)
    set_quiet_icon(box, icon)
    box.setStandardButtons(buttons)
    if default is not None:
        box.setDefaultButton(default)
    # exec() devolve int no PySide6 — converte pro enum pra comparação
    # `== StandardButton.Yes` funcionar nos call sites.
    return QMessageBox.StandardButton(box.exec())


def information(parent, title, text,
                buttons=QMessageBox.StandardButton.Ok, default=None):
    return _show(parent, QMessageBox.Icon.Information, title, text, buttons, default)


def warning(parent, title, text,
            buttons=QMessageBox.StandardButton.Ok, default=None):
    return _show(parent, QMessageBox.Icon.Warning, title, text, buttons, default)


def question(parent, title, text,
             buttons=QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
             default=None):
    return _show(parent, QMessageBox.Icon.Question, title, text, buttons, default)
