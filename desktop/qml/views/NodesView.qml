import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../components"

ColumnLayout {
    id: root
    spacing: 12

    SectionHeader {
        title: "Nodes (Registered Accounts)"
        subtitle: "Every registered account is a Node with per-Node traffic accounting and session status."
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: 8
        TextField {
            id: searchField
            placeholderText: "Search Nodes by username, display name, or Node ID..."
            Layout.fillWidth: true
            onAccepted: backend.refreshNodes(text)
        }
        Button {
            text: "Search"
            onClicked: backend.refreshNodes(searchField.text)
        }
    }

    ListView {
        Layout.fillWidth: true
        Layout.fillHeight: true
        clip: true
        spacing: 8
        model: backend.nodes

        delegate: Rectangle {
            required property var modelData
            width: ListView.view.width
            height: 76
            color: "#161b22"
            border.color: "#30363d"
            radius: 8

            RowLayout {
                anchors.fill: parent
                anchors.margins: 12
                spacing: 12

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 2
                    RowLayout {
                        spacing: 8
                        Text {
                            text: modelData.username + " (" + modelData.displayName + ")"
                            color: "#f0f6fc"
                            font.weight: Font.Bold
                        }
                        StatusBadge {
                            text: modelData.online ? "ONLINE" : "OFFLINE"
                            tone: modelData.online ? "ok" : "neutral"
                        }
                        StatusBadge {
                            text: modelData.status
                            tone: modelData.status === "active" ? "ok" : "danger"
                        }
                    }
                    Text {
                        text: "Node ID: " + modelData.nodeId + "  |  Devices: " + modelData.activeDevices + "  |  Sessions: " + modelData.activeSessions + "  |  Auth: " + modelData.passwordAlgorithm
                        color: "#8b949e"
                        font.pixelSize: 11
                    }
                    Text {
                        readonly property var tr: modelData.traffic || {}
                        text: "Traffic RX: " + (tr.totalRxBytes || 0) + " B  |  TX: " + (tr.totalTxBytes || 0) + " B  |  HTTP Req: " + (tr.requestCount || 0) + "  WS Frames: " + (tr.wsMessageCount || 0)
                        color: "#58a6ff"
                        font.pixelSize: 11
                    }
                }

                Button {
                    text: modelData.status === "active" ? "Suspend" : "Activate"
                    onClicked: backend.setNodeStatus(
                        modelData.nodeId,
                        modelData.status === "active" ? "suspended" : "active",
                        "dashboard_admin_action"
                    )
                }
            }
        }
    }
}
