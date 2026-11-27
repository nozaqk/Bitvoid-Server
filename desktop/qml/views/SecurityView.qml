import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../components"

ScrollView {
    id: root
    clip: true

    readonly property var sec: backend.securityInfo || {}
    readonly property var tls: sec.tls || {}
    readonly property var cert: tls.certificate || {}
    readonly property var ev24: sec.securityEvents24h || {}

    ColumnLayout {
        width: root.availableWidth - 32
        x: 16
        y: 16
        spacing: 16

        SectionHeader {
            title: "Security & Transport Posture"
            subtitle: "TLS certificate identity, administrator sessions, and brute-force protection telemetry."
        }

        GridLayout {
            Layout.fillWidth: true
            columns: 3
            columnSpacing: 12

            StatCard {
                Layout.fillWidth: true
                title: "TLS Transport"
                value: tls.enabled ? "HTTPS / WSS" : "HTTP (LAN Only)"
                subtitle: tls.enabled ? ("Expires in " + (cert.daysRemaining || 0) + " days") : "Configure BITVOID_TLS_CERT & KEY"
                accentColor: tls.enabled ? "#3fb950" : "#d29922"
            }
            StatCard {
                Layout.fillWidth: true
                title: "Auth Failures (24h)"
                value: String(ev24.failures || 0)
                subtitle: "Denied: " + (ev24.denied || 0) + "  Rate-limited: " + (ev24.rateLimited || 0)
                accentColor: (ev24.denied || 0) > 0 ? "#f85149" : "#3fb950"
            }
            StatCard {
                Layout.fillWidth: true
                title: "Admin IPC Boundary"
                value: "Local Only"
                subtitle: "Unix socket 0600 / Named pipe (No Web Admin)"
                accentColor: "#58a6ff"
            }
        }

        Rectangle {
            Layout.fillWidth: true
            color: "#161b22"
            border.color: "#30363d"
            radius: 8
            implicitHeight: certCol.implicitHeight + 24

            ColumnLayout {
                id: certCol
                anchors.fill: parent
                anchors.margins: 12
                spacing: 6
                Text { text: "TLS Certificate Pinning Fingerprint (SHA-256)"; color: "#f0f6fc"; font.weight: Font.Bold }
                Text {
                    text: cert.fingerprint256 || "TLS not configured"
                    color: "#58a6ff"
                    font.family: "monospace"
                    wrapMode: Text.WrapAnywhere
                    Layout.fillWidth: true
                }
            }
        }
    }
}
