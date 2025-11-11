use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("8gLZV8k3R6JrAs5BZzyyZQikjEfqvJjAz8PxbiYmz2Kb");

#[program]
pub mod oracle_v3 {
    use super::*;

    /// Initialize the asset registry (one-time setup)
    pub fn initialize_registry(ctx: Context<InitializeRegistry>, authority: Pubkey) -> Result<()> {
        instructions::initialize_registry(ctx, authority)
    }

    /// Register a new asset in the oracle
    pub fn register_asset(
        ctx: Context<RegisterAsset>,
        mint: Pubkey,
        symbol: String,
        decimals: u8,
        pyth_feed_id: Option<[u8; 32]>,
    ) -> Result<()> {
        instructions::register_asset(ctx, mint, symbol, decimals, pyth_feed_id)
    }

    /// Deactivate an asset (stops price updates)
    pub fn deactivate_asset(ctx: Context<UpdateAssetConfig>) -> Result<()> {
        instructions::deactivate_asset(ctx)
    }

    /// Activate an asset (resumes price updates)
    pub fn activate_asset(ctx: Context<UpdateAssetConfig>) -> Result<()> {
        instructions::activate_asset(ctx)
    }

    /// Update price for a single asset
    pub fn set_price(
        ctx: Context<SetPrice>,
        index: u8,
        price: i64,
        client_ts_ms: i64,
    ) -> Result<()> {
        instructions::set_price(ctx, index, price, client_ts_ms)
    }

    /// Batch update prices for multiple assets
    pub fn batch_set_prices<'info>(
        ctx: Context<'_, '_, '_, 'info, BatchSetPrices<'info>>,
        index: u8,
        updates: Vec<PriceUpdate>,
        client_ts_ms: i64,
    ) -> Result<()> {
        instructions::batch_set_prices(ctx, index, updates, client_ts_ms)
    }
}
