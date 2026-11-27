import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../components"

ColumnLayout {
    spacing: 12

    SectionHeader {
        title: "Structured Logs & Audit Events"
        subtitle: "Passwords, recovery keys, bearer tokens, and message bodies are automatically redacted."
    }

    RowLayout {
        spacing: 8
        ComboBox {
            id: levelFilter
            model: ["all", "info", "warn", "error"]
            onCurrentTextChanged: backend.refreshLogs(currentText, logSearch.text)
        }
        TextField {
            id: logSearch
            placeholderText: "Filter logs..."
            Layout.fillWidth: true
            onAccepted: backend.refreshLogs(levelFilter.currentText, text)
        }
        Button {
            text: "Filter"
            onClicked: backend.refreshLogs(levelFilter.currentText, logSearch.text)
        }
    }

    Text { text: "Service Logs (" + backend.logs.length + ")"; color: "#c9d1d9"; font.weight: Font.Bold }
    ListView {
        Layout.fillWidth: true
        Layout.preferredHeight: 220
        clip: true
        spacing: 4
        model: backend.logs

        delegate: Rectangle {
            required property var modelData
            width: ListView.view.width
            height: 40
            color: "#161b22"
            radius: 4
            RowLayout {
                anchors.fill: parent
                anchors.margins: 8
                spacing: 8
                StatusBadge {
                    text: modelData.level || "info"
                    tone: modelData.level === "error" ? "danger" : (modelData.level === "warn" ? "warn" : "neutral")
                }
                Text {
                    text: (modelData.timestamp || "") + " [" + (modelData.component || "") + "] " + (modelData.message || "")
                    color: "#c9d1d9"
                    font.family: "monospace"
                    font.pixelSize: 11
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                }
            }
        }
    }

    Text { text: "Security & Administrative Audit Log (" + backend.auditEvents.length + ")"; color: "#c9d1d9"; font.weight: Font.Bold }
    ListView {
        Layout.fillWidth: true
        Layout.fillHeight: true
        clip: true
        spacing: 4
        model: backend.auditEvents

        delegate: Rectangle {
            required property var modelData
            width: ListView.view.width
            height: 40
            color: "#161b22"
            radius: 4
            RowLayout {
                anchors.fill: parent
                anchors.margins: 8
                spacing: 8
                StatusBadge {
                    text: modelData.outcome || "ok"
                    tone: modelData.outcome === "success" ? "ok" : "danger"
                }
                Text {
                    text: (modelData.occurredAt || "") + "  " + (modelData.action || "") + "  actor=" + (modelData.actorType || "") + ":" + (modelData.actorId || "anon")
                    color: "#c9d1d9"
                    font.family: "monospace"
                    font.pixelSize: 11
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                }
            }
        }
    }
}
