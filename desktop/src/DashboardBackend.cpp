#include "DashboardBackend.h"

#include <QJsonArray>
#include <QJsonObject>

DashboardBackend::DashboardBackend(QObject *parent)
    : QObject(parent)
    , m_ipc(this)
    , m_service(this)
    , m_pollTimer(this)
{
    m_pollTimer.setInterval(5000);
    connect(&m_pollTimer, &QTimer::timeout, this, [this]() {
        if (m_authenticated) {
            refreshAll();
        } else {
            checkServerStatus();
        }
    });
    m_pollTimer.start();
    checkServerStatus();
}

void DashboardBackend::setIpcPath(const QString &path) {
    m_ipc.setIpcPath(path);
    emit stateChanged();
    checkServerStatus();
}

void DashboardBackend::setError(const QString &message) {
    m_lastError = message;
    emit errorChanged();
}

void DashboardBackend::setNotice(const QString &message) {
    m_lastNotice = message;
    emit noticeChanged();
}

void DashboardBackend::checkServerStatus() {
    m_osServiceStatus = m_service.queryServiceStatus();
    m_ipc.sendRequest(QStringLiteral("admin.status"), QJsonObject(),
        [this](bool ok, const QJsonObject &res, const QString &err) {
            m_serviceReachable = ok;
            if (ok) {
                m_initialized = res.value(QStringLiteral("initialized")).toBool(false);
                m_enrollmentFilePath = res.value(QStringLiteral("enrollmentFilePath")).toString();
                if (!m_lastError.isEmpty() && m_lastError.contains(QStringLiteral("Local IPC"))) {
                    setError(QString());
                }
            } else {
                m_offlineDiskLogs = m_service.readOfflineDiskLogs(80);
                setError(err);
                emit dataChanged();
            }
            emit stateChanged();
        });
}

void DashboardBackend::completeFirstRunSetup(const QString &enrollmentCode, const QString &username, const QString &password) {
    QJsonObject params;
    params.insert(QStringLiteral("enrollmentCode"), enrollmentCode.trimmed());
    params.insert(QStringLiteral("username"), username.trimmed());
    params.insert(QStringLiteral("password"), password);
    params.insert(QStringLiteral("clientInfo"), QStringLiteral("bitvoid-desktop-qt6"));

    m_ipc.sendRequest(QStringLiteral("admin.setup"), params,
        [this](bool ok, const QJsonObject &res, const QString &err) {
            if (!ok) {
                setError(err);
                return;
            }
            m_ipc.setAuthToken(res.value(QStringLiteral("token")).toString());
            m_adminUsername = res.value(QStringLiteral("admin")).toObject().value(QStringLiteral("username")).toString();
            m_initialized = true;
            m_authenticated = true;
            m_enrollmentFilePath.clear();
            setError(QString());
            setNotice(QStringLiteral("Administrator account created and signed in."));
            emit stateChanged();
            refreshAll();
        });
}

void DashboardBackend::loginAdmin(const QString &username, const QString &password) {
    QJsonObject params;
    params.insert(QStringLiteral("username"), username.trimmed());
    params.insert(QStringLiteral("password"), password);
    params.insert(QStringLiteral("clientInfo"), QStringLiteral("bitvoid-desktop-qt6"));

    m_ipc.sendRequest(QStringLiteral("admin.login"), params,
        [this](bool ok, const QJsonObject &res, const QString &err) {
            if (!ok) {
                setError(err);
                return;
            }
            m_ipc.setAuthToken(res.value(QStringLiteral("token")).toString());
            m_adminUsername = res.value(QStringLiteral("admin")).toObject().value(QStringLiteral("username")).toString();
            m_authenticated = true;
            setError(QString());
            setNotice(QStringLiteral("Signed in as administrator %1.").arg(m_adminUsername));
            emit stateChanged();
            refreshAll();
        });
}

void DashboardBackend::logoutAdmin() {
    m_ipc.sendRequest(QStringLiteral("admin.logout"), QJsonObject(),
        [this](bool, const QJsonObject &, const QString &) {
            m_ipc.setAuthToken(QString());
            m_authenticated = false;
            m_adminUsername.clear();
            setNotice(QStringLiteral("Administrator session signed out."));
            emit stateChanged();
        });
}

void DashboardBackend::refreshAll() {
    if (!m_authenticated) {
        checkServerStatus();
        return;
    }
    m_osServiceStatus = m_service.queryServiceStatus();

    m_ipc.sendRequest(QStringLiteral("overview.get"), QJsonObject(), [this](bool ok, const QJsonObject &res, const QString &err) {
        if (!ok) {
            m_serviceReachable = false;
            setError(err);
            emit stateChanged();
            return;
        }
        m_serviceReachable = true;
        m_overview = res.toVariantMap();
        emit stateChanged();
        emit dataChanged();
    });

    refreshNodes();

    m_ipc.sendRequest(QStringLiteral("devices.list"), QJsonObject(), [this](bool ok, const QJsonObject &res, const QString &) {
        if (ok) {
            m_devices = res.value(QStringLiteral("devices")).toArray().toVariantList();
            emit dataChanged();
        }
    });

    m_ipc.sendRequest(QStringLiteral("sessions.list"), QJsonObject(), [this](bool ok, const QJsonObject &res, const QString &) {
        if (ok) {
            m_sessions = res.value(QStringLiteral("sessions")).toArray().toVariantList();
            emit dataChanged();
        }
    });

    refreshNetwork();
    refreshLogs();

    m_ipc.sendRequest(QStringLiteral("audit.query"), QJsonObject{{QStringLiteral("limit"), 100}}, [this](bool ok, const QJsonObject &res, const QString &) {
        if (ok) {
            m_auditEvents = res.value(QStringLiteral("events")).toArray().toVariantList();
            emit dataChanged();
        }
    });

    m_ipc.sendRequest(QStringLiteral("security.overview"), QJsonObject(), [this](bool ok, const QJsonObject &res, const QString &) {
        if (ok) {
            m_securityInfo = res.toVariantMap();
            emit dataChanged();
        }
    });

    m_ipc.sendRequest(QStringLiteral("backups.list"), QJsonObject(), [this](bool ok, const QJsonObject &res, const QString &) {
        if (ok) {
            m_backups = res.value(QStringLiteral("backups")).toArray().toVariantList();
            emit dataChanged();
        }
    });

    m_ipc.sendRequest(QStringLiteral("database.status"), QJsonObject(), [this](bool ok, const QJsonObject &res, const QString &) {
        if (ok) {
            m_databaseStatus = res.toVariantMap();
            emit dataChanged();
        }
    });

    m_ipc.sendRequest(QStringLiteral("config.get"), QJsonObject(), [this](bool ok, const QJsonObject &res, const QString &) {
        if (ok) {
            m_serverConfig = res.toVariantMap();
            emit dataChanged();
        }
    });

    m_ipc.sendRequest(QStringLiteral("updates.status"), QJsonObject(), [this](bool ok, const QJsonObject &res, const QString &) {
        if (ok) {
            m_updateStatus = res.toVariantMap();
            emit dataChanged();
        }
    });
}

void DashboardBackend::refreshNodes(const QString &search) {
    QJsonObject params;
    if (!search.trimmed().isEmpty()) params.insert(QStringLiteral("search"), search.trimmed());
    m_ipc.sendRequest(QStringLiteral("nodes.list"), params, [this](bool ok, const QJsonObject &res, const QString &) {
        if (ok) {
            m_nodes = res.value(QStringLiteral("nodes")).toArray().toVariantList();
            emit dataChanged();
        }
    });
}

void DashboardBackend::setNodeStatus(const QString &nodeId, const QString &status, const QString &reason) {
    QJsonObject params{
        {QStringLiteral("nodeId"), nodeId},
        {QStringLiteral("status"), status},
        {QStringLiteral("reason"), reason}
    };
    m_ipc.sendRequest(QStringLiteral("nodes.setStatus"), params, [this, status](bool ok, const QJsonObject &, const QString &err) {
        if (!ok) setError(err);
        else {
            setNotice(QStringLiteral("Node status updated to %1.").arg(status));
            refreshAll();
        }
    });
}

void DashboardBackend::revokeDevice(const QString &deviceId) {
    m_ipc.sendRequest(QStringLiteral("devices.revoke"), QJsonObject{{QStringLiteral("deviceId"), deviceId}},
        [this](bool ok, const QJsonObject &, const QString &err) {
            if (!ok) setError(err);
            else {
                setNotice(QStringLiteral("Device revoked and active sessions disconnected."));
                refreshAll();
            }
        });
}

void DashboardBackend::revokeSession(const QString &sessionId) {
    m_ipc.sendRequest(QStringLiteral("sessions.revoke"), QJsonObject{{QStringLiteral("sessionId"), sessionId}},
        [this](bool ok, const QJsonObject &, const QString &err) {
            if (!ok) setError(err);
            else {
                setNotice(QStringLiteral("Session revoked and realtime sockets disconnected."));
                refreshAll();
            }
        });
}

void DashboardBackend::cleanupExpiredSessions() {
    m_ipc.sendRequest(QStringLiteral("sessions.cleanup"), QJsonObject(),
        [this](bool ok, const QJsonObject &res, const QString &err) {
            if (!ok) setError(err);
            else {
                setNotice(QStringLiteral("Cleaned up %1 expired session row(s).").arg(res.value(QStringLiteral("deletedRows")).toInt()));
                refreshAll();
            }
        });
}

void DashboardBackend::refreshNetwork() {
    m_ipc.sendRequest(QStringLiteral("network.overview"), QJsonObject(), [this](bool ok, const QJsonObject &res, const QString &) {
        if (ok) {
            m_networkInfo = res.toVariantMap();
            emit dataChanged();
        }
    });
}

void DashboardBackend::startHotspot(const QString &ssid, const QString &passphrase) {
    QJsonObject params{{QStringLiteral("ssid"), ssid}};
    if (!passphrase.isEmpty()) params.insert(QStringLiteral("passphrase"), passphrase);
    m_ipc.sendRequest(QStringLiteral("network.hotspot.start"), params,
        [this](bool ok, const QJsonObject &res, const QString &err) {
            if (!ok) setError(err);
            else {
                setNotice(QStringLiteral("Hotspot '%1' active on %2.").arg(
                    res.value(QStringLiteral("ssid")).toString(),
                    res.value(QStringLiteral("interfaceName")).toString()));
                refreshNetwork();
            }
        });
}

void DashboardBackend::stopHotspot() {
    m_ipc.sendRequest(QStringLiteral("network.hotspot.stop"), QJsonObject(),
        [this](bool ok, const QJsonObject &, const QString &err) {
            if (!ok) setError(err);
            else {
                setNotice(QStringLiteral("Wi-Fi hotspot stopped."));
                refreshNetwork();
            }
        });
}

void DashboardBackend::createVpnProfile(const QString &name, const QString &provider, const QString &host, int port, const QString &dnsName) {
    QJsonObject params{
        {QStringLiteral("name"), name},
        {QStringLiteral("provider"), provider},
        {QStringLiteral("endpointHost"), host},
        {QStringLiteral("endpointPort"), port},
        {QStringLiteral("dnsName"), dnsName}
    };
    m_ipc.sendRequest(QStringLiteral("network.vpn.create"), params,
        [this](bool ok, const QJsonObject &, const QString &err) {
            if (!ok) setError(err);
            else {
                setNotice(QStringLiteral("VPN profile saved."));
                refreshNetwork();
            }
        });
}

void DashboardBackend::deleteVpnProfile(const QString &profileId) {
    m_ipc.sendRequest(QStringLiteral("network.vpn.delete"), QJsonObject{{QStringLiteral("profileId"), profileId}},
        [this](bool ok, const QJsonObject &, const QString &err) {
            if (!ok) setError(err);
            else {
                setNotice(QStringLiteral("VPN profile deleted."));
                refreshNetwork();
            }
        });
}

void DashboardBackend::refreshLogs(const QString &level, const QString &search) {
    QJsonObject params{{QStringLiteral("limit"), 150}};
    if (!level.isEmpty() && level != QStringLiteral("all")) params.insert(QStringLiteral("level"), level);
    if (!search.trimmed().isEmpty()) params.insert(QStringLiteral("search"), search.trimmed());
    m_ipc.sendRequest(QStringLiteral("logs.query"), params, [this](bool ok, const QJsonObject &res, const QString &) {
        if (ok) {
            m_logs = res.value(QStringLiteral("entries")).toArray().toVariantList();
            emit dataChanged();
        }
    });
}

void DashboardBackend::createBackup(const QString &passphrase) {
    QJsonObject params;
    if (!passphrase.isEmpty()) params.insert(QStringLiteral("passphrase"), passphrase);
    m_ipc.sendRequest(QStringLiteral("backups.create"), params,
        [this](bool ok, const QJsonObject &res, const QString &err) {
            if (!ok) setError(err);
            else {
                const QString fname = res.value(QStringLiteral("backup")).toObject().value(QStringLiteral("filename")).toString();
                setNotice(QStringLiteral("Backup created: %1").arg(fname));
                refreshAll();
            }
        }, 30000);
}

void DashboardBackend::verifyBackup(const QString &backupId, const QString &passphrase) {
    QJsonObject params{{QStringLiteral("backupId"), backupId}};
    if (!passphrase.isEmpty()) params.insert(QStringLiteral("passphrase"), passphrase);
    m_ipc.sendRequest(QStringLiteral("backups.verify"), params,
        [this](bool ok, const QJsonObject &res, const QString &err) {
            if (!ok) setError(err);
            else {
                setNotice(res.value(QStringLiteral("notes")).toString(QStringLiteral("Backup verified successfully.")));
                refreshAll();
            }
        }, 30000);
}

void DashboardBackend::runDatabaseIntegrityCheck() {
    m_ipc.sendRequest(QStringLiteral("database.integrityCheck"), QJsonObject(),
        [this](bool ok, const QJsonObject &res, const QString &err) {
            if (!ok) setError(err);
            else {
                const bool healthy = res.value(QStringLiteral("ok")).toBool(false);
                setNotice(healthy ? QStringLiteral("SQLite integrity_check and foreign_key_check passed.")
                                  : QStringLiteral("Database integrity check reported issues!"));
                refreshAll();
            }
        });
}

void DashboardBackend::startBackgroundService() {
    QString out;
    if (m_service.startService(&out)) {
        setNotice(QStringLiteral("Background Server service start requested."));
    } else {
        setError(QStringLiteral("Could not start OS service (%1). Check OS privileges or run manually.").arg(out));
    }
    checkServerStatus();
}

void DashboardBackend::stopBackgroundService() {
    if (m_authenticated && m_serviceReachable) {
        m_ipc.sendRequest(QStringLiteral("service.shutdown"), QJsonObject(), [this](bool ok, const QJsonObject &, const QString &err) {
            if (ok) setNotice(QStringLiteral("Graceful Server shutdown initiated."));
            else setError(err);
            QTimer::singleShot(500, this, &DashboardBackend::checkServerStatus);
        });
        return;
    }
    QString out;
    if (m_service.stopService(&out)) {
        setNotice(QStringLiteral("Background Server service stopped."));
    } else {
        setError(QStringLiteral("Could not stop OS service: %1").arg(out));
    }
    checkServerStatus();
}

void DashboardBackend::restartBackgroundService() {
    QString out;
    if (m_service.restartService(&out)) {
        setNotice(QStringLiteral("Background Server service restart requested."));
    } else {
        setError(QStringLiteral("Could not restart OS service: %1").arg(out));
    }
    QTimer::singleShot(1000, this, &DashboardBackend::checkServerStatus);
}

void DashboardBackend::loadOfflineDiagnostics() {
    m_osServiceStatus = m_service.queryServiceStatus();
    m_offlineDiskLogs = m_service.readOfflineDiskLogs(150);
    emit stateChanged();
    emit dataChanged();
}
