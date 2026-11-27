import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../components"

ScrollView {
    id: root
    clip: true

    readonly property var metrics: backend.overview.metrics || {}
    readonly property var server: backend.overview.server || {}
    readonly property var nodesStats: metrics.nodes || {}
    readonly property var devStats: metrics.devices || {}
    readonly property var sessStats: metrics.sessions || {}
    readonly property var procStats: metrics.process || {}
    readonly property var hostStats: metrics.host || {}
    readonly property var storageStats: metrics.storage || {}
    readonly property var trafficStats: metrics.traffic || {}

    function fmtBytes(bytes) {
        if (!bytes || bytes <= 0) return "0 B"
        const units = ["B", "KB", "MB", "GB"]
        let idx = 0
        let val = bytes
        while (val >= 1024 && idx < units.length - 1) { val /= 1024; idx++ }
        return val.toFixed(1) + " " + units[idx]
    }

    ColumnLayout {
        width: root.availableWidth - 32
        x: 16
        y: 16
        spacing: 16

        SectionHeader {
            title: "Server Overview"
            subtitle: "Server ID: " + (server.serverId || "--") + "  |  Mode: " + (server.deploymentMode || "--") + " / " + (server.networkMode || "--")
        }

        GridLayout {
            Layout.fillWidth: true
            columns: 4
            columnSpacing: 12
            rowSpacing: 12

            StatCard {
                Layout.fillWidth: true
                title: "Registered Nodes"
                value: String(nodesStats.total || 0)
                subtitle: "Online: " + (nodesStats.onlineWebsocket || 0) + "  Offline: " + (nodesStats.offlineWebsocket || 0)
                accentColor: "#38bdf8"
            }
            StatCard {
                Layout.fillWidth: true
                title: "Active Devices"
                value: String(devStats.active || 0)
                subtitle: "Total: " + (devStats.total || 0) + "  Revoked: " + (devStats.revoked || 0)
                accentColor: "#3fb950"
            }
            StatCard {
                Layout.fillWidth: true
                title: "Active Sessions"
                value: String(sessStats.active || 0)
                subtitle: "Expired: " + (sessStats.expired || 0) + "  Revoked: " + (sessStats.revoked || 0)
                accentColor: "#a371f7"
            }
            StatCard {
                Layout.fillWidth: true
                title: "Server Uptime"
                value: Math.floor((metrics.uptimeSeconds || 0) / 60) + "m"
                subtitle: (metrics.uptimeSeconds || 0) + "s  |  PID " + (procStats.pid || "--")
                accentColor: "#f0883e"
            }
        }

        GridLayout {
            Layout.fillWidth: true
            columns: 3
            columnSpacing: 12
            rowSpacing: 12

            StatCard {
                Layout.fillWidth: true
                title: "CPU & Memory"
                value: (procStats.cpuPercent || 0) + "% CPU"
                subtitle: "Process RSS: " + fmtBytes(procStats.rssBytes) + " / Host Free: " + fmtBytes(hostStats.freeMemoryBytes)
                accentColor: "#58a6ff"
            }
            StatCard {
                Layout.fillWidth: true
                title: "Managed Storage"
                value: fmtBytes(storageStats.totalManagedBytes)
                subtitle: "DB: " + fmtBytes(storageStats.databaseBytes) + "  Media: " + fmtBytes(storageStats.mediaBytes) + "  Backups: " + fmtBytes(storageStats.backupBytes)
                accentColor: "#d29922"
            }
            StatCard {
                Layout.fillWidth: true
                title: "Application Traffic"
                value: fmtBytes(trafficStats.appRxBytesPerSec) + "/s ↓"
                subtitle: "Out: " + fmtBytes(trafficStats.appTxBytesPerSec) + "/s ↑  |  Total RX: " + fmtBytes(trafficStats.appRxBytes) + "  TX: " + fmtBytes(trafficStats.appTxBytes)
                accentColor: "#3fb950"
            }
        }

        Rectangle {
            visible: Boolean(server.tlsWarning)
            Layout.fillWidth: true
            color: "#3b2c0c"
            border.color: "#d29922"
            radius: 8
            implicitHeight: tlsWarnText.implicitHeight + 20

            Text {
                id: tlsWarnText
                anchors.fill: parent
                anchors.margins: 10
                text: "Transport Notice: " + (server.tlsWarning || "")
                color: "#f0c674"
                wrapMode: Text.WordWrap
                font.pixelSize: 12
            }
        }
    }
}
