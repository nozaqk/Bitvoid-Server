import QtQuick
import QtQuick.Layouts

RowLayout {
    id: root
    property string title: ""
    property string subtitle: ""

    Layout.fillWidth: true
    spacing: 12

    ColumnLayout {
        spacing: 2
        Layout.fillWidth: true

        Text {
            text: root.title
            color: "#f0f6fc"
            font.pixelSize: 20
            font.weight: Font.Bold
        }

        Text {
            text: root.subtitle
            color: "#8b949e"
            font.pixelSize: 12
            visible: text.length > 0
        }
    }
}
