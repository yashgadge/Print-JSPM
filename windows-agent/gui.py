import sys
import threading
from PyQt6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, 
                             QHBoxLayout, QLabel, QPushButton, QListWidget, 
                             QGroupBox, QComboBox, QCheckBox, QSpinBox)
from PyQt6.QtCore import pyqtSignal, QObject

class AgentSignals(QObject):
    job_added = pyqtSignal(dict)
    status_updated = pyqtSignal(str)

class XeroxPrintAgentGUI(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Xerox Print Agent - Shop Dashboard")
        self.setGeometry(100, 100, 800, 600)
        self.signals = AgentSignals()
        
        self.init_ui()
        self.init_agent()
        
    def init_ui(self):
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        layout = QHBoxLayout(main_widget)
        
        # Left Panel (Queue & Controls)
        left_panel = QVBoxLayout()
        
        # Status
        self.lbl_status = QLabel("Status: Idle")
        self.lbl_status.setStyleSheet("font-size: 16px; font-weight: bold; color: blue;")
        left_panel.addWidget(self.lbl_status)
        
        # Controls
        controls_layout = QHBoxLayout()
        self.btn_start = QPushButton("▶ Start Queue")
        self.btn_pause = QPushButton("⏸ Pause")
        self.btn_resume = QPushButton("⏯ Resume")
        
        controls_layout.addWidget(self.btn_start)
        controls_layout.addWidget(self.btn_pause)
        controls_layout.addWidget(self.btn_resume)
        left_panel.addLayout(controls_layout)
        
        # Queue List
        left_panel.addWidget(QLabel("Pending Queue:"))
        self.lst_queue = QListWidget()
        left_panel.addWidget(self.lst_queue)
        
        # Job Actions
        job_actions = QHBoxLayout()
        self.btn_retry = QPushButton("Retry Job")
        self.btn_cancel = QPushButton("Cancel Job")
        job_actions.addWidget(self.btn_retry)
        job_actions.addWidget(self.btn_cancel)
        left_panel.addLayout(job_actions)
        
        layout.addLayout(left_panel, 2)
        
        # Right Panel (Settings)
        right_panel = QVBoxLayout()
        
        # Printers Group
        grp_printers = QGroupBox("Printer Mapping")
        printers_layout = QVBoxLayout()
        
        printers_layout.addWidget(QLabel("B/W Printer:"))
        self.cmb_bw_printer = QComboBox()
        self.cmb_bw_printer.addItems(["Default", "HP LaserJet 1020", "Canon LBP2900"])
        printers_layout.addWidget(self.cmb_bw_printer)
        
        printers_layout.addWidget(QLabel("Color Printer:"))
        self.cmb_color_printer = QComboBox()
        self.cmb_color_printer.addItems(["Default", "Epson L3150", "Canon G3000"])
        printers_layout.addWidget(self.cmb_color_printer)
        
        grp_printers.setLayout(printers_layout)
        right_panel.addWidget(grp_printers)
        
        # Behavior Group
        grp_behavior = QGroupBox("Behavior Settings")
        behavior_layout = QVBoxLayout()
        
        self.chk_autostart = QCheckBox("Auto-Start Jobs")
        behavior_layout.addWidget(self.chk_autostart)
        
        behavior_layout.addWidget(QLabel("Parallel Jobs Limit:"))
        self.spn_parallel = QSpinBox()
        self.spn_parallel.setRange(1, 5)
        self.spn_parallel.setValue(1)
        behavior_layout.addWidget(self.spn_parallel)
        
        grp_behavior.setLayout(behavior_layout)
        right_panel.addWidget(grp_behavior)
        
        right_panel.addStretch()
        layout.addLayout(right_panel, 1)
        
    def init_agent(self):
        # We will connect the Firebase listener in the background thread
        pass

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = XeroxPrintAgentGUI()
    window.show()
    sys.exit(app.exec())
