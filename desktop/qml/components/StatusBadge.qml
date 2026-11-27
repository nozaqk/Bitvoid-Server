import QtQuick

Rectangle {
    id: badge
    property string text: "unknown"
    property string tone: "neutral" // ok, warn, danger, neutral

    readonly property color bgColor: tone === "ok" ? "#123524"
                                   : tone === "warn" ? "#3b2c0c"
                                   : tone === "danger" ? "#3f1518"
                                   : "#21262d"
    readonly property color fgColor: tone === "ok" ? "#3fb950"
                                   : tone === "warn" ? "#d29922"
                                   : tone === "danger" ? "#f85149"
                                   : "#c9d1d9"

    color: bgColor
    radius: 10
    implicitWidth: label.implicitWidth + 16
    implicitHeight: 22

    Text {
        id: label
        anchors.centerIn: parent
        text: badge.text
        color: badge.fgColor
        font.pixelSize: 11
        font.weight: Font.DemiBold
    }
}
