#pragma once

#include <QObject>
#include <QString>
#include <QStringList>

/**
 * OS-native background Server service lifecycle manager & independent failure diagnostics.
 * Remains functional even when the BitVoid Server background service is stopped or crashed,
 * allowing administrators to inspect disk logs and start/stop/restart the service.
 */
class ServiceController : public QObject {
    Q_OBJECT

public:
    explicit ServiceController(QObject *parent = nullptr);

    QString queryServiceStatus() const;
    bool startService(QString *outputMessage = nullptr) const;
    bool stopService(QString *outputMessage = nullptr) const;
    bool restartService(QString *outputMessage = nullptr) const;

    /**
     * Read trailing log lines directly from disk for diagnosing service startup failures
     * when the background service IPC channel is unreachable.
     */
    QStringList readOfflineDiskLogs(int maxLines = 120) const;

    static QString resolveDefaultLogFilePath();

private:
    bool runOsCommand(const QString &program, const QStringList &args, QString *out) const;
};
