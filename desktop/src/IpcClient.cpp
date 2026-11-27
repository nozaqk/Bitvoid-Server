#include "IpcClient.h"

#include <QDir>
#include <QFileInfo>
#include <QJsonDocument>
#include <QLocalSocket>
#include <QStandardPaths>
#include <QTimer>
#include <memory>

IpcClient::IpcClient(QObject *parent)
    : QObject(parent)
    , m_ipcPath(resolveDefaultIpcPath())
{
}

QString IpcClient::resolveDefaultIpcPath() {
    const QByteArray envPath = qgetenv("BITVOID_IPC_PATH");
    if (!envPath.isEmpty()) {
        return QString::fromUtf8(envPath);
    }
#ifdef Q_OS_WIN
    return QStringLiteral("\\\\.\\pipe\\bitvoid-server-admin");
#elif defined(Q_OS_MACOS)
    const QString dataDir = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    return QDir(dataDir).filePath(QStringLiteral("bitvoid-admin.sock"));
#else
    const QByteArray envDataDir = qgetenv("BITVOID_DATA_DIR");
    if (!envDataDir.isEmpty()) {
        return QDir(QString::fromUtf8(envDataDir)).filePath(QStringLiteral("bitvoid-admin.sock"));
    }
    const QString xdg = QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation);
    const QString systemSocket = QStringLiteral("/var/lib/bitvoid-server/bitvoid-admin.sock");
    if (QFileInfo::exists(systemSocket)) {
        return systemSocket;
    }
    return QDir(xdg + QStringLiteral("/bitvoid-server")).filePath(QStringLiteral("bitvoid-admin.sock"));
#endif
}

void IpcClient::setIpcPath(const QString &path) {
    if (!path.trimmed().isEmpty()) {
        m_ipcPath = path.trimmed();
    }
}

QString IpcClient::ipcPath() const {
    return m_ipcPath;
}

void IpcClient::setAuthToken(const QString &token) {
    m_authToken = token;
}

QString IpcClient::authToken() const {
    return m_authToken;
}

void IpcClient::sendRequest(const QString &method,
                            const QJsonObject &params,
                            ResultCallback callback,
                            int timeoutMs)
{
    auto *socket = new QLocalSocket(this);
    auto *timer = new QTimer(socket);
    timer->setSingleShot(true);

    auto settled = std::make_shared<bool>(false);
    auto buffer = std::make_shared<QByteArray>();

    auto finish = [socket, timer, settled, callback](bool ok, const QJsonObject &result, const QString &errorMsg) {
        if (*settled) return;
        *settled = true;
        timer->stop();
        socket->abort();
        socket->deleteLater();
        if (callback) {
            callback(ok, result, errorMsg);
        }
    };

    const QString reqId = QStringLiteral("qt_%1").arg(m_nextId++);
    QJsonObject request;
    request.insert(QStringLiteral("jsonrpc"), QStringLiteral("2.0"));
    request.insert(QStringLiteral("id"), reqId);
    request.insert(QStringLiteral("method"), method);
    request.insert(QStringLiteral("params"), params);
    if (!m_authToken.isEmpty()) {
        request.insert(QStringLiteral("authToken"), m_authToken);
    }

    const QByteArray wireFrame = QJsonDocument(request).toJson(QJsonDocument::Compact) + '\n';

    connect(timer, &QTimer::timeout, socket, [finish, method]() {
        finish(false, QJsonObject(), QStringLiteral("Local IPC request timed out: %1").arg(method));
    });

    connect(socket, &QLocalSocket::errorOccurred, socket, [socket, finish](QLocalSocket::LocalSocketError) {
        finish(false, QJsonObject(), QStringLiteral("Local IPC connection error: %1").arg(socket->errorString()));
    });

    connect(socket, &QLocalSocket::connected, socket, [socket, wireFrame]() {
        socket->write(wireFrame);
        socket->flush();
    });

    connect(socket, &QLocalSocket::readyRead, socket, [socket, buffer, finish]() {
        buffer->append(socket->readAll());
        const int nlIndex = buffer->indexOf('\n');
        if (nlIndex < 0) return;

        const QByteArray line = buffer->left(nlIndex).trimmed();
        QJsonParseError parseError;
        const QJsonDocument doc = QJsonDocument::fromJson(line, &parseError);
        if (parseError.error != QJsonParseError::NoError || !doc.isObject()) {
            finish(false, QJsonObject(), QStringLiteral("Malformed JSON-RPC response from Server IPC."));
            return;
        }

        const QJsonObject obj = doc.object();
        if (obj.contains(QStringLiteral("error")) && obj.value(QStringLiteral("error")).isObject()) {
            const QJsonObject errObj = obj.value(QStringLiteral("error")).toObject();
            finish(false, errObj, errObj.value(QStringLiteral("message")).toString(QStringLiteral("IPC error")));
            return;
        }

        const QJsonValue resultVal = obj.value(QStringLiteral("result"));
        finish(true, resultVal.isObject() ? resultVal.toObject() : QJsonObject(), QString());
    });

    timer->start(timeoutMs);
    socket->connectToServer(m_ipcPath);
}
