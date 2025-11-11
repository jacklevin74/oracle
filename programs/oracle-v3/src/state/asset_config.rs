use anchor_lang::prelude::*;

/// Configuration for a specific asset
#[account]
pub struct AssetConfig {
    /// SPL token mint address (or special marker for native assets)
    pub mint: Pubkey,
    /// Asset symbol (e.g., "SOL", "USDC", "BONK")
    pub symbol: [u8; 16],
    /// Price decimals (typically 6)
    pub decimals: u8,
    /// Whether the asset is active
    pub is_active: bool,
    /// Optional Pyth feed ID (32 bytes)
    pub pyth_feed_id: Option<[u8; 32]>,
    /// Timestamp when asset was added
    pub added_at: i64,
    /// PDA bump
    pub bump: u8,
}

impl AssetConfig {
    pub const SIZE: usize = 32 + 16 + 1 + 1 + (1 + 32) + 8 + 1;
    pub const SEED: &'static [u8] = b"asset_config";

    pub fn symbol_as_string(&self) -> String {
        String::from_utf8_lossy(
            &self.symbol[..self.symbol.iter().position(|&b| b == 0).unwrap_or(16)]
        ).to_string()
    }
}
