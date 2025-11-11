use anchor_lang::prelude::*;

/// Price data for a specific asset (one per asset)
#[account]
pub struct PriceData {
    /// Links back to the asset mint
    pub mint: Pubkey,
    /// Price data from 4 updaters
    pub prices: Triplet,
    /// Last update timestamp
    pub last_update: i64,
    /// PDA bump
    pub bump: u8,
}

impl PriceData {
    pub const SIZE: usize = 32 + Triplet::SIZE + 8 + 1;
    pub const SEED: &'static [u8] = b"price_data";
}

/// Stores prices from 4 independent updaters with timestamps
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct Triplet {
    pub param1: i64,
    pub param2: i64,
    pub param3: i64,
    pub param4: i64,
    pub ts1: i64,
    pub ts2: i64,
    pub ts3: i64,
    pub ts4: i64,
}

impl Triplet {
    pub const SIZE: usize = 8 * 8; // 64 bytes
}
