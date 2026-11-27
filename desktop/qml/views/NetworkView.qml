import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../components"

ScrollView {
    id: root
    clip: true

    readonly property var net: backend.networkInfo || {}
    readonly property var hotspot: net.hotspot || {}
    readonly property var hotspotCap: hotspot.capability || {}
    readonly property var hotspotState: hotspot.status || {}
    readonly property var ifaces: net.interfaces || {}
    readonly property var vpnProfiles: net.vpnProfiles || []

    ColumnLayout {
        width: root.availableWidth - 32
        x: 16
        y: 16
        spacing: 16

        SectionHeader {
            title: "Networking: Direct Hotspot, LAN & Multi-Site VPN"
            subtitle: "Local communication operates independently of Internet availability."
        }

        // Mode 1: Direct Computer-Hosted Wi-Fi Hotspot
        Rectangle {
            Layout.fillWidth: true
            color: "#161b22"
            border.color: "#30363d"
            radius: 8
            implicitHeight: hsCol.implicitHeight + 24

            ColumnLayout {
                id: hsCol
                anchors.fill: parent
                anchors.margins: 12
                spacing: 8

                RowLayout {
                    Text { text: "Mode 1: Direct Computer Wi-Fi Hotspot"; color: "#f0f6fc"; font.weight: Font.Bold; Layout.fillWidth: true }
                    StatusBadge {
                        text: hotspotState.active ? "HOTSPOT ACTIVE" : (hotspotCap.supported ? "CAPABLE" : "UNSUPPORTED")
                        tone: hotspotState.active ? "ok" : (hotspotCap.supported ? "warn" : "neutral")
                    }
                }

                Text {
                    text: hotspotCap.supported
                          ? ("Adapter: " + (hotspotCap.adapter || "--") + "  |  " + (hotspotCap.permissionNote || "Ready"))
                          : ("Unavailable: " + (hotspotCap.reason || "Hardware or OS does not expose programmatic AP hosting."))
                    color: "#8b949e"
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }

                RowLayout {
                    visible: Boolean(hotspotCap.supported)
                    spacing: 8
                    TextField { id: ssidField; placeholderText: "SSID (default BitVoid-Local)"; text: "BitVoid-Local"; Layout.preferredWidth: 200 }
                    TextField { id: hsPassField; placeholderText: "WPA2/WPA3 Passphrase (auto if blank)"; echoMode: TextInput.Password; Layout.fillWidth: true }
                    Button { text: "Start Hotspot"; enabled: !hotspotState.active; onClicked: backend.startHotspot(ssidField.text, hsPassField.text) }
                    Button { text: "Stop Hotspot"; enabled: Boolean(hotspotState.active); onClicked: backend.stopHotspot() }
                }
            }
        }

        // Mode 2: Existing Router / Ethernet LAN
        Rectangle {
            Layout.fillWidth: true
            color: "#161b22"
            border.color: "#30363d"
            radius: 8
            implicitHeight: lanCol.implicitHeight + 24

            ColumnLayout {
                id: lanCol
                anchors.fill: parent
                anchors.margins: 12
                spacing: 6

                Text { text: "Mode 2: Router / Ethernet LAN Endpoints"; color: "#f0f6fc"; font.weight: Font.Bold }
                Repeater {
                    model: ifaces.recommendedLanUrls || []
                    Text {
                        required property var modelData
                        text: modelData.interface + " -> " + modelData.url
                        color: "#58a6ff"
                        font.family: "monospace"
                    }
                }
                Text {
                    visible: Boolean(ifaces.publicExposureWarning)
                    text: "Security Warning: " + (ifaces.publicExposureWarning || "")
                    color: "#f85149"
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }
            }
        }

        // Mode 3: Multi-Location VPN Profiles
        Rectangle {
            Layout.fillWidth: true
            color: "#161b22"
            border.color: "#30363d"
            radius: 8
            implicitHeight: vpnCol.implicitHeight + 24

            ColumnLayout {
                id: vpnCol
                anchors.fill: parent
                anchors.margins: 12
                spacing: 8

                Text { text: "Mode 3: Multi-Location VPN / Private Links (" + vpnProfiles.length + ")"; color: "#f0f6fc"; font.weight: Font.Bold }

                RowLayout {
                    spacing: 8
                    TextField { id: vpnName; placeholderText: "Profile Name"; Layout.preferredWidth: 150 }
                    TextField { id: vpnHost; placeholderText: "VPN IP / Private DNS"; Layout.fillWidth: true }
                    TextField { id: vpnPort; placeholderText: "Port"; text: "8787"; Layout.preferredWidth: 70 }
                    Button {
                        text: "Add WireGuard Profile"
                        onClicked: backend.createVpnProfile(vpnName.text, "wireguard", vpnHost.text, parseInt(vpnPort.text || "8787"), vpnHost.text)
                    }
                }

                Repeater {
                    model: vpnProfiles
                    RowLayout {
                        required property var modelData
                        Layout.fillWidth: true
                        Text {
                            text: modelData.name + " (" + modelData.provider + ") -> " + modelData.endpointHost + ":" + modelData.endpointPort
                            color: "#c9d1d9"
                            Layout.fillWidth: true
                        }
                        Button {
                            text: "Delete"
                            onClicked: backend.deleteVpnProfile(modelData.id)
                        }
                    }
                }
            }
        }
    }
}
