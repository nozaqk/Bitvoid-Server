import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../components"

ColumnLayout {
    spacing: 12

    SectionHeader {
        title: "Devices & Sessions"
        subtitle: "Revoking a device or session immediately terminates its authenticated realtime WebSocket connections."
    }

    RowLayout {
        spacing: 8
        Button {
            text: "Cleanup Expired Sessions"
            onClicked: backend.cleanupExpiredSessions()
        }
        Button {
            text: "Refresh"
            onClicked: backend.refreshAll()
        }
    }

    Text { text: "Registered Devices (" + backend.devices.length + ")"; color: "#c9d1d9"; font.weight: Font.Bold }

    ListView {
        Layout.fillWidth: true
        Layout.preferredHeight: 200
        clip: true
        spacing: 6
        model: backend.devices

        delegate: Rectangle {
            required property var modelData
            width: ListView.view.width
            height: 54
            color: "#161b22"
            border.color: "#30363d"
            radius: 6

            RowLayout {
                anchors.fill: parent
                anchors.margins: 10
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 2
                    Text {
                        text: modelData.displayName + " [" + modelData.platform + "] — Node: " + (modelData.username || modelData.nodeId)
                        color: "#f0f6fc"
                        font.pixelSize: 12
                        font.weight: Font.Medium
                    }
                    Text {
                        text: "Device ID: " + modelData.id + "  |  Trust: " + modelData.trustStatus + "  |  Active Sessions: " + modelData.activeSessions
                        color: "#8b949e"
                        font.pixelSize: 11
                    }
                }
                Button {
                    text: "Revoke Device"
                    enabled: modelData.trustStatus !== "revoked"
                    onClicked: backend.revokeDevice(modelData.id)
                }
            }
        }
    }

    Text { text: "Sessions (" + backend.sessions.length + ")"; color: "#c9d1d9"; font.weight: Font.Bold }

    ListView {
        Layout.fillWidth: true
        Layout.fillHeight: true
        clip: true
        spacing: 6
        model: backend.sessions

        delegate: Rectangle {
            required property var modelData
            width: ListView.view.width
            height: 54
            color: "#161b22"
            border.color: "#30363d"
            radius: 6

            RowLayout {
                anchors.fill: parent
                anchors.margins: 10
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 2
                    RowLayout {
                        spacing: 8
                        Text {
                            text: (modelData.username || modelData.nodeId) + " — " + (modelData.deviceName || "Unbound Device")
                            color: "#f0f6fc"
                            font.pixelSize: 12
                        }
                        StatusBadge {
                            text: modelData.status
                            tone: modelData.status === "active" ? "ok" : (modelData.status === "expired" ? "warn" : "danger")
                        }
                    }
                    Text {
                        text: "Session: " + modelData.id + "  |  Expires: " + modelData.expiresAt
                        color: "#8b949e"
                        font.pixelSize: 11
                    }
                }
                Button {
                    text: "Revoke"
                    enabled: modelData.status === "active"
                    onClicked: backend.revokeSession(modelData.id)
                }
            }
        }
    }
}
