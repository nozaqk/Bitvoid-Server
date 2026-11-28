#include <QApplication>
#include <QIcon>
#include <QMenu>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickStyle>
#include <QSystemTrayIcon>
#include <QWindow>

#include "DashboardBackend.h"

int main(int argc, char *argv[]) {
    QApplication app(argc, argv);
    app.setOrganizationName(QStringLiteral("AirMesh"));
    app.setApplicationName(QStringLiteral("AirMesh Server"));
    app.setApplicationVersion(QStringLiteral("1.1.0"));

    // Closing the dashboard window must NOT stop the background AirMesh Server service.
    app.setQuitOnLastWindowClosed(true);

    QQuickStyle::setStyle(QStringLiteral("Basic"));

    DashboardBackend backend;
    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty(QStringLiteral("backend"), &backend);

    const QUrl url(QStringLiteral("qrc:/qt/qml/BitVoidDesktop/qml/Main.qml"));
    QObject::connect(
        &engine,
        &QQmlApplicationEngine::objectCreationFailed,
        &app,
        []() { QCoreApplication::exit(-1); },
        Qt::QueuedConnection
    );
    engine.load(url);

    // Optional native system tray menu when desktop environment supports system tray icons.
    if (QSystemTrayIcon::isSystemTrayAvailable() && !engine.rootObjects().isEmpty()) {
        auto *mainWindow = qobject_cast<QWindow *>(engine.rootObjects().first());
        auto *tray = new QSystemTrayIcon(&app);
        tray->setToolTip(QStringLiteral("AirMesh Server Dashboard (Background Service Independent)"));
        auto *menu = new QMenu();
        menu->addAction(QStringLiteral("Show Dashboard"), [mainWindow]() {
            if (mainWindow) {
                mainWindow->show();
                mainWindow->raise();
                mainWindow->requestActivate();
            }
        });
        menu->addAction(QStringLiteral("Refresh Metrics"), [&backend]() {
            backend.refreshAll();
        });
        menu->addSeparator();
        menu->addAction(QStringLiteral("Close Dashboard (Keep Server Running)"), &app, &QCoreApplication::quit);
        tray->setContextMenu(menu);
        tray->show();
    }

    return app.exec();
}
