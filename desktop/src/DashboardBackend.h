#pragma once

#include <QObject>
#include <QTimer>
#include <QVariantList>
#include <QVariantMap>

#include "IpcClient.h"
#include "ServiceController.h"

/**
 * QML ViewModel bridging the native Qt 6 Desktop Dashboard to the AirMesh Server local IPC
 * and OS background service lifecycle controller.
 */
class DashboardBackend : public QObject {
    Q_OBJECT

    Q_PROPERTY(bool serviceReachable READ serviceReachable NOTIFY stateChanged)
    Q_PROPERTY(QString osServiceStatus READ osServiceStatus NOTIFY stateChanged)
    Q_PROPERTY(bool initialized READ initialized NOTIFY stateChanged)
    Q_PROPERTY(bool authenticated READ authenticated NOTIFY stateChanged)
    Q_PROPERTY(QString adminUsername READ adminUsername NOTIFY stateChanged)
    Q_PROPERTY(QString enrollmentFilePath READ enrollmentFilePath NOTIFY stateChanged)
    Q_PROPERTY(QString ipcPath READ ipcPath WRITE setIpcPath NOTIFY stateChanged)
    Q_PROPERTY(QString lastError READ lastError NOTIFY errorChanged)
    Q_PROPERTY(QString lastNotice READ lastNotice NOTIFY noticeChanged)

    Q_PROPERTY(QVariantMap overview READ overview NOTIFY dataChanged)
    Q_PROPERTY(QVariantList nodes READ nodes NOTIFY dataChanged)
    Q_PROPERTY(QVariantList devices READ devices NOTIFY dataChanged)
    Q_PROPERTY(QVariantList sessions READ sessions NOTIFY dataChanged)
    Q_PROPERTY(QVariantMap networkInfo READ networkInfo NOTIFY dataChanged)
    Q_PROPERTY(QVariantList logs READ logs NOTIFY dataChanged)
    Q_PROPERTY(QVariantList auditEvents READ auditEvents NOTIFY dataChanged)
    Q_PROPERTY(QVariantMap securityInfo READ securityInfo NOTIFY dataChanged)
    Q_PROPERTY(QVariantList backups READ backups NOTIFY dataChanged)
    Q_PROPERTY(QVariantMap databaseStatus READ databaseStatus NOTIFY dataChanged)
    Q_PROPERTY(QVariantMap serverConfig READ serverConfig NOTIFY dataChanged)
    Q_PROPERTY(QVariantMap updateStatus READ updateStatus NOTIFY dataChanged)
    Q_PROPERTY(QStringList offlineDiskLogs READ offlineDiskLogs NOTIFY dataChanged)

public:
    explicit DashboardBackend(QObject *parent = nullptr);

    bool serviceReachable() const { return m_serviceReachable; }
    QString osServiceStatus() const { return m_osServiceStatus; }
    bool initialized() const { return m_initialized; }
    bool authenticated() const { return m_authenticated; }
    QString adminUsername() const { return m_adminUsername; }
    QString enrollmentFilePath() const { return m_enrollmentFilePath; }
    QString ipcPath() const { return m_ipc.ipcPath(); }
    void setIpcPath(const QString &path);
    QString lastError() const { return m_lastError; }
    QString lastNotice() const { return m_lastNotice; }

    QVariantMap overview() const { return m_overview; }
    QVariantList nodes() const { return m_nodes; }
    QVariantList devices() const { return m_devices; }
    QVariantList sessions() const { return m_sessions; }
    QVariantMap networkInfo() const { return m_networkInfo; }
    QVariantList logs() const { return m_logs; }
    QVariantList auditEvents() const { return m_auditEvents; }
    QVariantMap securityInfo() const { return m_securityInfo; }
    QVariantList backups() const { return m_backups; }
    QVariantMap databaseStatus() const { return m_databaseStatus; }
    QVariantMap serverConfig() const { return m_serverConfig; }
    QVariantMap updateStatus() const { return m_updateStatus; }
    QStringList offlineDiskLogs() const { return m_offlineDiskLogs; }

    // Bootstrap & Administrator Authentication
    Q_INVOKABLE void checkServerStatus();
    Q_INVOKABLE void completeFirstRunSetup(const QString &enrollmentCode, const QString &username, const QString &password);
    Q_INVOKABLE void loginAdmin(const QString &username, const QString &password);
    Q_INVOKABLE void logoutAdmin();

    // Dashboard Refresh & Domain Actions
    Q_INVOKABLE void refreshAll();
    Q_INVOKABLE void refreshNodes(const QString &search = QString());
    Q_INVOKABLE void setNodeStatus(const QString &nodeId, const QString &status, const QString &reason = QString());
    Q_INVOKABLE void revokeDevice(const QString &deviceId);
    Q_INVOKABLE void revokeSession(const QString &sessionId);
    Q_INVOKABLE void cleanupExpiredSessions();

    Q_INVOKABLE void refreshNetwork();
    Q_INVOKABLE void startHotspot(const QString &ssid, const QString &passphrase);
    Q_INVOKABLE void stopHotspot();
    Q_INVOKABLE void createVpnProfile(const QString &name, const QString &provider, const QString &host, int port, const QString &dnsName);
    Q_INVOKABLE void deleteVpnProfile(const QString &profileId);

    Q_INVOKABLE void refreshLogs(const QString &level = QString(), const QString &search = QString());
    Q_INVOKABLE void createBackup(const QString &passphrase);
    Q_INVOKABLE void verifyBackup(const QString &backupId, const QString &passphrase);
    Q_INVOKABLE void runDatabaseIntegrityCheck();

    // Independent OS Background Service Lifecycle
    Q_INVOKABLE void startBackgroundService();
    Q_INVOKABLE void stopBackgroundService();
    Q_INVOKABLE void restartBackgroundService();
    Q_INVOKABLE void loadOfflineDiagnostics();

signals:
    void stateChanged();
    void dataChanged();
    void errorChanged();
    void noticeChanged();

private:
    void setError(const QString &message);
    void setNotice(const QString &message);

    IpcClient m_ipc;
    ServiceController m_service;
    QTimer m_pollTimer;

    bool m_serviceReachable = false;
    QString m_osServiceStatus = QStringLiteral("unknown");
    bool m_initialized = false;
    bool m_authenticated = false;
    QString m_adminUsername;
    QString m_enrollmentFilePath;
    QString m_lastError;
    QString m_lastNotice;

    QVariantMap m_overview;
    QVariantList m_nodes;
    QVariantList m_devices;
    QVariantList m_sessions;
    QVariantMap m_networkInfo;
    QVariantList m_logs;
    QVariantList m_auditEvents;
    QVariantMap m_securityInfo;
    QVariantList m_backups;
    QVariantMap m_databaseStatus;
    QVariantMap m_serverConfig;
    QVariantMap m_updateStatus;
    QStringList m_offlineDiskLogs;
};
