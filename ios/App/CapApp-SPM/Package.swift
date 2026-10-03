// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.2"),
        .package(name: "CapacitorHaptics", path: "../../../node_modules/@capacitor/haptics"),
        .package(name: "CapacitorStatusBar", path: "../../../node_modules/@capacitor/status-bar"),
        .package(name: "CordovaPluginPurchase", path: "../../capacitor-cordova-ios-plugins/sources/CordovaPluginPurchase")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorHaptics", package: "CapacitorHaptics"),
                .product(name: "CapacitorStatusBar", package: "CapacitorStatusBar"),
                .product(name: "CordovaPluginPurchase", package: "CordovaPluginPurchase")
            ]
        )
    ]
)
