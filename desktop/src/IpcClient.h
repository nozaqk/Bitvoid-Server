#pragma once

#include <QObject>
#include <QJsonObject>
#include <QString>
#include <functional>

/**
 * Protected local IPC JSON-RPC 2.0 client speaking over QLocalSocket
 * (Unix domain socket on Linux/macOS; Windows named pipe on Windows).
 */
class IpcClient : public QObject {
    Q_OBJECT

public:
    explicit IpcClient(QObject *parent = nullptr);

    void setIpcPath(const QString &path);
    QString ipcPath() const;

    void setAuthToken(const QString &token);
    QString authToken() const;

    using ResultCallback = std::function<void(bool ok, const QJsonObject &result, const QString &errorMessage)>;

    void sendRequest(const QString &method,
                     const QJsonObject &params,
                     ResultCallback callback,
                     int timeoutMs = 30000);

    static QString resolveDefaultIpcPath();

private:
    QString m_ipcPath;
    QString m_authToken;
    quint64 m_nextId = 1;
};
