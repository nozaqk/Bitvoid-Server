import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "components"
import "views"

ApplicationWindow {
    id: win
    visible: true
    width: 1240
    height: 820
    minimumWidth: 960
    minimumHeight: 640
    title: "AirMesh Server — Desktop Administration Dashboard"
    color: "#0d1117"

    property int currentTab: 0
    readonly property var navItems: [
        "Overview",
        "Nodes",
        "Devices & Sessions",
        "Network & Hotspot",
        "Logs & Audit",
        "Security",
        "Backups & DB",
        "Settings & Updates"
    ]

    // First-run setup / Admin login / Offline diagnostics gate
    FirstRunSetupDialog {
        anchors.fill: parent
        visible: !backend.authenticated
    }

    Dialog {
        id: stopServerDialog
        modal: true
        anchors.centerIn: parent
        width: 440
        title: "Stop AirMesh Server?"
        standardButtons: Dialog.Yes | Dialog.No

        Label {
            width: parent.width
            wrapMode: Text.WordWrap
            color: "#c9d1d9"
            text: "Stopping the Server will disconnect connected AirMesh clients and interrupt local messaging until the background service is started again. The dashboard can remain open. Are you sure you want to stop the Server?"
        }

        onAccepted: backend.stopBackgroundService()
    }

    // Authenticated Native Desktop Dashboard
    RowLayout {
        anchors.fill: parent
        visible: backend.authenticated
        spacing: 0

        // Left Navigation Sidebar
        Rectangle {
            Layout.preferredWidth: 230
            Layout.fillHeight: true
            color: "#161b22"

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 14
                spacing: 6

                Text {
                    text: "AirMesh Server"
                    color: "#f0f6fc"
                    font.pixelSize: 18
                    font.weight: Font.Bold
                }
                StatusBadge {
                    text: backend.serviceReachable ? "SERVICE RUNNING" : "SERVICE OFFLINE"
                    tone: backend.serviceReachable ? "ok" : "danger"
                }

                Item { height: 10 }

                Repeater {
                    model: win.navItems
                    Button {
                        required property int index
                        required property string modelData
                        text: modelData
                        Layout.fillWidth: true
                        highlighted: win.currentTab === index
                        onClicked: win.currentTab = index
                    }
                }

                Item { Layout.fillHeight: true }

                Text {
                    text: "Admin: " + backend.adminUsername
                    color: "#8b949e"
                    font.pixelSize: 11
                }
                RowLayout {
                    Layout.fillWidth: true
                    spacing: 6
                    Button {
                        text: "Restart"
                        Layout.fillWidth: true
                        onClicked: backend.restartBackgroundService()
                    }
                    Button {
                        text: "Stop"
                        Layout.fillWidth: true
                        onClicked: stopServerDialog.open()
                    }
                }
                Button {
                    text: "Sign Out"
                    Layout.fillWidth: true
                    onClicked: backend.logoutAdmin()
                }
            }
        }

        // Main Content Workspace
        ColumnLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 0

            // Top Notice / Error Banner
            Rectangle {
                visible: backend.lastError.length > 0 || backend.lastNotice.length > 0
                Layout.fillWidth: true
                implicitHeight: 36
                color: backend.lastError.length > 0 ? "#3f1518" : "#123524"

                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: 16
                    anchors.rightMargin: 16
                    Text {
                        text: backend.lastError.length > 0 ? backend.lastError : backend.lastNotice
                        color: backend.lastError.length > 0 ? "#f85149" : "#3fb950"
                        font.pixelSize: 12
                        elide: Text.ElideRight
                        Layout.fillWidth: true
                    }
                    Button {
                        text: "Refresh"
                        onClicked: backend.refreshAll()
                    }
                }
            }

            StackLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.margins: 16
                currentIndex: win.currentTab

                OverviewView {}
                NodesView {}
                DevicesSessionsView {}
                NetworkView {}
                ActivityLogsView {}
                SecurityView {}
                BackupsDatabaseView {}
                SettingsUpdatesView {}
            }
        }
    }
}
