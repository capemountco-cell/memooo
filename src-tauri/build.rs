fn main() {
    // The screencapturekit crate (system audio) includes Swift code that needs
    // the Swift runtime macOS ships in /usr/lib/swift. A dependency's
    // build script cannot add a search path to our binary, so we add it here;
    // without it the app aborts at launch with "Library not loaded:
    // @rpath/libswift_Concurrency.dylib".
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
    tauri_build::build();
}
