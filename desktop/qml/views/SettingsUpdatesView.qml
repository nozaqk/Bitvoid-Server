import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../components"

ScrollView {
    id: root
    clip: true

    readonly property var cfg: backend.serverConfig || {}
    readonly property var upd: backend.updateStatus || {}

    ColumnLayout {
        width: root.availableWidth - 32
        x: 16
        y: 16
        spacing: 16

        SectionHeader {
            title: "Server Configuration & Software Updates"
            subtitle: "Active Server runtime settings and verified versioned release status."
        }

        Rectangle {
            Layout.fillWidth: true
            color: "#161b22"
            border.color: "#30363d"
            radius: 8
            implicitHeight: cfgCol.implicitHeight + 24

            ColumnLayout {
                id: cfgCol
                anchors.fill: parent
                anchors.margins: 12
                spacing: 6
                Text { text: "Runtime Configuration"; color: "#f0f6fc"; font.weight: Font.Bold }
                Text { text: "Display Name: " + (cfg.displayName || "--"); color: "#c9d1d9" }
                Text { text: "Bind: " + (cfg.host || "--") + ":" + (cfg.port || "--") + "  |  Deployment: " + (cfg.deploymentMode || "--"); color: "#c9d1d9" }
                Text { text: "Data Directory: " + (cfg.dataDir || "--"); color: "#8b949e"; font.pixelSize: 11 }
                Text { text: "Local IPC Endpoint: " + (cfg.ipcPath || "--"); color: "#8b949e"; font.pixelSize: 11 }
                Text { text: "Session TTL: " + (cfg.tokenTtl || "--") + "  |  Refresh TTL: " + (cfg.refreshTtl || "--"); color: "#8b949e"; font.pixelSize: 11 }
            }
        }

        Rectangle {
            Layout.fillWidth: true
            color: "#161b22"
            border.color: "#30363d"
            radius: 8
            implicitHeight: updCol.implicitHeight + 24

            ColumnLayout {
                id: updCol
                anchors.fill: parent
                anchors.margins: 12
                spacing: 6
                RowLayout {
                    Text { text: "Software Updates"; color: "#f0f6fc"; font.weight: Font.Bold; Layout.fillWidth: true }
                    StatusBadge {
                        text: upd.updateAvailable ? ("UPDATE " + upd.availableVersion) : ("UP TO DATE v" + (upd.installedVersion || "1.1.0"))
                        tone: upd.updateAvailable ? "warn" : "ok"
                    }
                }
                Text {
                    text: upd.policy || "Updates require verified SHA-256 checksums and explicit administrator approval."
                    color: "#8b949e"
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }
            }
        }
    }
}
