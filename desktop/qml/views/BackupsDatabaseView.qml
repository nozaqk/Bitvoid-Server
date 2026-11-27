import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../components"

ColumnLayout {
    spacing: 12

    readonly property var db: backend.databaseStatus || {}
    readonly property var dbStats: db.stats || {}
    readonly property var mig: db.migrations || {}
    readonly property var integrity: db.integrity || {}

    SectionHeader {
        title: "Database & Encrypted Backups"
        subtitle: "Consistent online SQLite WAL backups with automated restore integrity verification."
    }

    Rectangle {
        Layout.fillWidth: true
        color: "#161b22"
        border.color: "#30363d"
        radius: 8
        implicitHeight: dbRow.implicitHeight + 24

        RowLayout {
            id: dbRow
            anchors.fill: parent
            anchors.margins: 12
            spacing: 12

            ColumnLayout {
                Layout.fillWidth: true
                Text {
                    text: "SQLite " + (dbStats.sqliteVersion || "--") + "  |  Journal: " + (dbStats.journalMode || "--") + "  |  Schema v" + (mig.currentVersion || 0)
                    color: "#f0f6fc"
                    font.weight: Font.Bold
                }
                Text {
                    text: "Path: " + (db.databasePath || "--") + "  |  Integrity: " + (integrity.ok ? "OK" : "CHECK NEEDED")
                    color: "#8b949e"
                    font.pixelSize: 11
                }
            }
            Button {
                text: "Run Integrity Check"
                onClicked: backend.runDatabaseIntegrityCheck()
            }
        }
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: 8
        TextField {
            id: backupPassField
            placeholderText: "Optional Backup Encryption Passphrase (12+ chars for AES-256-GCM)"
            echoMode: TextInput.Password
            Layout.fillWidth: true
        }
        Button {
            text: "Create Online Backup"
            onClicked: backend.createBackup(backupPassField.text)
        }
    }

    ListView {
        Layout.fillWidth: true
        Layout.fillHeight: true
        clip: true
        spacing: 6
        model: backend.backups

        delegate: Rectangle {
            required property var modelData
            width: ListView.view.width
            height: 60
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
                        Text { text: modelData.filename; color: "#f0f6fc"; font.pixelSize: 12; font.weight: Font.Medium }
                        StatusBadge {
                            text: modelData.encrypted ? "ENCRYPTED" : "PLAIN"
                            tone: modelData.encrypted ? "ok" : "warn"
                        }
                        StatusBadge {
                            text: modelData.status
                            tone: modelData.status === "verified" ? "ok" : "neutral"
                        }
                    }
                    Text {
                        text: "Schema v" + modelData.schemaVersion + "  |  Size: " + modelData.sizeBytes + " B  |  " + (modelData.verificationNotes || modelData.createdAt)
                        color: "#8b949e"
                        font.pixelSize: 11
                    }
                }
                Button {
                    text: "Verify"
                    onClicked: backend.verifyBackup(modelData.id, backupPassField.text)
                }
            }
        }
    }
}
