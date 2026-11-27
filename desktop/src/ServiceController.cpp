#include "ServiceController.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QProcess>
#include <QStandardPaths>
#include <QTextStream>

ServiceController::ServiceController(QObject *parent)
    : QObject(parent)
{
}

bool ServiceController::runOsCommand(const QString &program, const QStringList &args, QString *out) const {
    QProcess proc;
    proc.start(program, args);
    if (!proc.waitForFinished(10000)) {
        if (out) *out = QStringLiteral("Timed out waiting for %1").arg(program);
        return false;
    }
    const QString stdoutStr = QString::fromUtf8(proc.readAllStandardOutput()).trimmed();
    const QString stderrStr = QString::fromUtf8(proc.readAllStandardError()).trimmed();
    if (out) {
        *out = !stdoutStr.isEmpty() ? stdoutStr : stderrStr;
    }
    return proc.exitStatus() == QProcess::NormalExit && proc.exitCode() == 0;
}

QString ServiceController::queryServiceStatus() const {
    QString out;
#ifdef Q_OS_WIN
    if (runOsCommand(QStringLiteral("sc.exe"), {QStringLiteral("query"), QStringLiteral("BitVoidServer")}, &out)) {
        if (out.contains(QStringLiteral("RUNNING"), Qt::CaseInsensitive)) return QStringLiteral("running");
        if (out.contains(QStringLiteral("STOPPED"), Qt::CaseInsensitive)) return QStringLiteral("stopped");
        return QStringLiteral("transitioning");
    }
    return QStringLiteral("not-installed");
#elif defined(Q_OS_MACOS)
    if (runOsCommand(QStringLiteral("launchctl"), {QStringLiteral("list"), QStringLiteral("com.bitvoid.server")}, &out)) {
        return out.contains(QStringLiteral("PID")) ? QStringLiteral("running") : QStringLiteral("stopped");
    }
    return QStringLiteral("not-installed");
#else
    if (runOsCommand(QStringLiteral("systemctl"), {QStringLiteral("is-active"), QStringLiteral("bitvoid-server.service")}, &out)) {
        return QStringLiteral("running");
    }
    if (out.contains(QStringLiteral("inactive")) || out.contains(QStringLiteral("failed"))) {
        return out.trimmed();
    }
    return QStringLiteral("not-installed");
#endif
}

bool ServiceController::startService(QString *outputMessage) const {
#ifdef Q_OS_WIN
    return runOsCommand(QStringLiteral("sc.exe"), {QStringLiteral("start"), QStringLiteral("BitVoidServer")}, outputMessage);
#elif defined(Q_OS_MACOS)
    return runOsCommand(QStringLiteral("launchctl"), {QStringLiteral("start"), QStringLiteral("com.bitvoid.server")}, outputMessage);
#else
    return runOsCommand(QStringLiteral("systemctl"), {QStringLiteral("start"), QStringLiteral("bitvoid-server.service")}, outputMessage);
#endif
}

bool ServiceController::stopService(QString *outputMessage) const {
#ifdef Q_OS_WIN
    return runOsCommand(QStringLiteral("sc.exe"), {QStringLiteral("stop"), QStringLiteral("BitVoidServer")}, outputMessage);
#elif defined(Q_OS_MACOS)
    return runOsCommand(QStringLiteral("launchctl"), {QStringLiteral("stop"), QStringLiteral("com.bitvoid.server")}, outputMessage);
#else
    return runOsCommand(QStringLiteral("systemctl"), {QStringLiteral("stop"), QStringLiteral("bitvoid-server.service")}, outputMessage);
#endif
}

bool ServiceController::restartService(QString *outputMessage) const {
#ifdef Q_OS_WIN
    QString stopOut;
    stopService(&stopOut);
    return startService(outputMessage);
#elif defined(Q_OS_MACOS)
    QString stopOut;
    stopService(&stopOut);
    return startService(outputMessage);
#else
    return runOsCommand(QStringLiteral("systemctl"), {QStringLiteral("restart"), QStringLiteral("bitvoid-server.service")}, outputMessage);
#endif
}

QString ServiceController::resolveDefaultLogFilePath() {
    const QByteArray envLogDir = qgetenv("BITVOID_LOG_DIR");
    if (!envLogDir.isEmpty()) {
        return QDir(QString::fromUtf8(envLogDir)).filePath(QStringLiteral("bitvoid-server.log"));
    }
#ifdef Q_OS_WIN
    const QString progData = qEnvironmentVariable("PROGRAMDATA", QStringLiteral("C:/ProgramData"));
    return QDir(progData + QStringLiteral("/BitVoidServer/logs")).filePath(QStringLiteral("bitvoid-server.log"));
#elif defined(Q_OS_MACOS)
    const QString dataDir = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    return QDir(dataDir + QStringLiteral("/logs")).filePath(QStringLiteral("bitvoid-server.log"));
#else
    const QString sysLog = QStringLiteral("/var/lib/bitvoid-server/logs/bitvoid-server.log");
    if (QFileInfo::exists(sysLog)) return sysLog;
    const QString xdg = QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation);
    return QDir(xdg + QStringLiteral("/bitvoid-server/logs")).filePath(QStringLiteral("bitvoid-server.log"));
#endif
}

QStringList ServiceController::readOfflineDiskLogs(int maxLines) const {
    QFile file(resolveDefaultLogFilePath());
    if (!file.open(QIODevice::ReadOnly | QIODevice::Text)) {
        return {QStringLiteral("Log file not found at %1").arg(resolveDefaultLogFilePath())};
    }
    QStringList allLines;
    QTextStream in(&file);
    while (!in.atEnd()) {
        allLines.append(in.readLine());
    }
    if (allLines.size() <= maxLines) {
        return allLines;
    }
    return allLines.mid(allLines.size() - maxLines);
}
