use anchor_lang::prelude::*;

/// Global asset registry account
#[account]
pub struct AssetRegistry {
    /// Authority that can add new assets
    pub authority: Pubkey,
    /// Total number of registered assets
    pub asset_count: u32,
    /// PDA bump
    pub bump: u8,
}

impl AssetRegistry {
    pub const SIZE: usize = 32 + 4 + 1;
    pub const SEED: &'static [u8] = b"registry";
}
