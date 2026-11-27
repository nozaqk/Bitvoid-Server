cmake_minimum_required(VERSION 3.21)

project(BitVoidServerDesktop VERSION 1.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 6.5 REQUIRED COMPONENTS Core Gui Widgets Quick QuickControls2 Network)

qt_standard_project_setup(REQUIRES 6.5)

qt_add_executable(bitvoid-server-desktop
    src/main.cpp
    src/IpcClient.h
    src/IpcClient.cpp
    src/ServiceController.h
    src/ServiceController.cpp
    src/DashboardBackend.h
    src/DashboardBackend.cpp
)

if(WIN32)
    enable_language(RC)
    target_sources(bitvoid-server-desktop PRIVATE bitvoid-server-desktop.rc)
    set_source_files_properties(bitvoid-server-desktop.rc PROPERTIES
        COMPILE_FLAGS "/I${CMAKE_CURRENT_SOURCE_DIR}"
    )
endif()

qt_add_qml_module(bitvoid-server-desktop
    URI BitVoidDesktop
    VERSION 1.0
    QML_FILES
        qml/Main.qml
        qml/FirstRunSetupDialog.qml
        qml/components/StatCard.qml
        qml/components/StatusBadge.qml
        qml/components/SectionHeader.qml
        qml/views/OverviewView.qml
        qml/views/NodesView.qml
        qml/views/DevicesSessionsView.qml
        qml/views/NetworkView.qml
        qml/views/ActivityLogsView.qml
        qml/views/SecurityView.qml
        qml/views/BackupsDatabaseView.qml
        qml/views/SettingsUpdatesView.qml
)

set_target_properties(bitvoid-server-desktop PROPERTIES
    MACOSX_BUNDLE TRUE
    MACOSX_BUNDLE_GUI_IDENTIFIER com.bitvoid.server.desktop
    MACOSX_BUNDLE_BUNDLE_VERSION ${PROJECT_VERSION}
    MACOSX_BUNDLE_SHORT_VERSION_STRING ${PROJECT_VERSION_MAJOR}.${PROJECT_VERSION_MINOR}
    WIN32_EXECUTABLE TRUE
)

target_link_libraries(bitvoid-server-desktop PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
    Qt6::Quick
    Qt6::QuickControls2
    Qt6::Network
)

install(TARGETS bitvoid-server-desktop
    BUNDLE DESTINATION .
    RUNTIME DESTINATION bin
)
