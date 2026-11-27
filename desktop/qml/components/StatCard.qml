import QtQuick
import QtQuick.Layouts

Rectangle {
    id: root
    property string title: ""
    property string value: "--"
    property string subtitle: ""
    property color accentColor: "#38bdf8"

    color: "#161b22"
    border.color: "#30363d"
    border.width: 1
    radius: 8
    implicitHeight: 96
    implicitWidth: 180

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 14
        spacing: 4

        Text {
            text: root.title
            color: "#8b949e"
            font.pixelSize: 12
            font.weight: Font.Medium
            elide: Text.ElideRight
            Layout.fillWidth: true
        }

        Text {
            text: root.value
            color: root.accentColor
            font.pixelSize: 24
            font.weight: Font.Bold
            elide: Text.ElideRight
            Layout.fillWidth: true
        }

        Text {
            text: root.subtitle
            color: "#8b949e"
            font.pixelSize: 11
            elide: Text.ElideRight
            Layout.fillWidth: true
            visible: text.length > 0
        }
    }
}
