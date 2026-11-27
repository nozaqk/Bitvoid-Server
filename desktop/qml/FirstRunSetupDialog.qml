import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    id: root
    color: "#0d1117"

    ColumnLayout {
        anchors.centerIn: parent
        width: Math.min(parent.width - 48, 460)
        spacing: 16

        Text {
            text: "BitVoid Server Administration"
            color: "#f0f6fc"
            font.pixelSize: 24
            font.weight: Font.Bold
            Layout.alignment: Qt.AlignHCenter
        }

        Text {
            text: !backend.serviceReachable
                  ? "The background BitVoid Server service is not currently reachable over local IPC. You can start the service or inspect offline disk logs below."
                  : (!backend.initialized
                     ? "First-Run Security Setup: Enter the one-time local enrollment code created on this computer to register the initial Server Administrator."
                     : "Sign in with your Server Administrator credentials. Node account passwords cannot access Server administration.")
            color: "#8b949e"
            wrapMode: Text.WordWrap
            horizontalAlignment: Text.AlignHCenter
            Layout.fillWidth: true
        }

        Rectangle {
            Layout.fillWidth: true
            color: "#161b22"
            border.color: "#30363d"
            border.width: 1
            radius: 10
            implicitHeight: formLayout.implicitHeight + 32

            ColumnLayout {
                id: formLayout
                anchors.fill: parent
                anchors.margins: 16
                spacing: 12

                // Offline Service Recovery Mode (accessible independently of background service!)
                ColumnLayout {
                    visible: !backend.serviceReachable
                    Layout.fillWidth: true
                    spacing: 10

                    Text {
                        text: "OS Service Status: " + backend.osServiceStatus
                        color: "#d29922"
                        font.weight: Font.DemiBold
                    }
                    Text {
                        text: "IPC Endpoint: " + backend.ipcPath
                        color: "#8b949e"
                        font.pixelSize: 11
                        elide: Text.ElideMiddle
                        Layout.fillWidth: true
                    }

                    RowLayout {
                        spacing: 8
                        Button {
                            text: "Start Service"
                            onClicked: backend.startBackgroundService()
                        }
                        Button {
                            text: "Retry IPC"
                            onClicked: backend.checkServerStatus()
                        }
                        Button {
                            text: "Read Disk Logs"
                            onClicked: backend.loadOfflineDiagnostics()
                        }
                    }

                    ScrollView {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 160
                        TextArea {
                            readOnly: true
                            text: backend.offlineDiskLogs.join("\n")
                            color: "#c9d1d9"
                            font.family: "monospace"
                            font.pixelSize: 11
                            background: Rectangle { color: "#0d1117"; radius: 6 }
                        }
                    }
                }

                // First-Run Setup Form (No Default Passwords!)
                ColumnLayout {
                    visible: backend.serviceReachable && !backend.initialized
                    Layout.fillWidth: true
                    spacing: 10

                    Text {
                        text: "Enrollment file: " + backend.enrollmentFilePath
                        color: "#58a6ff"
                        font.pixelSize: 11
                        wrapMode: Text.WrapAnywhere
                        Layout.fillWidth: true
                    }

                    TextField {
                        id: enrollCodeField
                        placeholderText: "One-time Enrollment Code (XXXX-XXXX-...)"
                        Layout.fillWidth: true
                    }
                    TextField {
                        id: setupUserField
                        placeholderText: "Administrator Username (2-24 chars)"
                        Layout.fillWidth: true
                    }
                    TextField {
                        id: setupPassField
                        placeholderText: "Strong Administrator Password (12+ chars)"
                        echoMode: TextInput.Password
                        Layout.fillWidth: true
                    }
                    Button {
                        text: "Create Administrator Account"
                        Layout.fillWidth: true
                        onClicked: backend.completeFirstRunSetup(
                            enrollCodeField.text,
                            setupUserField.text,
                            setupPassField.text
                        )
                    }
                }

                // Returning Administrator Sign-In
                ColumnLayout {
                    visible: backend.serviceReachable && backend.initialized
                    Layout.fillWidth: true
                    spacing: 10

                    TextField {
                        id: loginUserField
                        placeholderText: "Administrator Username"
                        Layout.fillWidth: true
                    }
                    TextField {
                        id: loginPassField
                        placeholderText: "Administrator Password"
                        echoMode: TextInput.Password
                        Layout.fillWidth: true
                        onAccepted: backend.loginAdmin(loginUserField.text, loginPassField.text)
                    }
                    Button {
                        text: "Sign In to Server Dashboard"
                        Layout.fillWidth: true
                        onClicked: backend.loginAdmin(loginUserField.text, loginPassField.text)
                    }
                }

                Text {
                    visible: backend.lastError.length > 0
                    text: backend.lastError
                    color: "#f85149"
                    wrapMode: Text.WordWrap
                    font.pixelSize: 12
                    Layout.fillWidth: true
                }
            }
        }
    }
}
