#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    eprintln!("[init] Tauri main 진입");
    battle_cats_sprite_modder_lib::run();
}
