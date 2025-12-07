use anchor_lang::prelude::*;
use crate::errors::OracleError;
use crate::state::*;

/// Initialize the asset registry (one-time setup)
pub fn initialize_registry(ctx: Context<InitializeRegistry>, authority: Pubkey) -> Result<()> {
    let registry = &mut ctx.accounts.registry;
    registry.authority = authority;
    registry.asset_count = 0;
    registry.bump = *ctx.bumps.get("registry").unwrap();
    Ok(())
}

/// Register a new asset in the oracle
pub fn register_asset(
    ctx: Context<RegisterAsset>,
    mint: Pubkey,
    symbol: String,
    decimals: u8,
    pyth_feed_id: Option<[u8; 32]>,
) -> Result<()> {
    let registry = &mut ctx.accounts.registry;
    let asset_config = &mut ctx.accounts.asset_config;
    let price_data = &mut ctx.accounts.price_data;

    // Validate authority
    require_keys_eq!(
        ctx.accounts.authority.key(),
        registry.authority,
        OracleError::Unauthorized
    );

    // Validate symbol length
    require!(symbol.len() <= 16, OracleError::SymbolTooLong);

    // Initialize asset config
    asset_config.mint = mint;

    let mut symbol_bytes = [0u8; 16];
    symbol_bytes[..symbol.len()].copy_from_slice(symbol.as_bytes());
    asset_config.symbol = symbol_bytes;

    asset_config.decimals = decimals;
    asset_config.is_active = true;
    asset_config.pyth_feed_id = pyth_feed_id;
    asset_config.added_at = Clock::get()?.unix_timestamp;
    asset_config.bump = *ctx.bumps.get("asset_config").unwrap();

    // Initialize price data
    price_data.mint = mint;
    price_data.prices = Triplet::default();
    price_data.last_update = 0;
    price_data.bump = *ctx.bumps.get("price_data").unwrap();

    // Increment asset count
    registry.asset_count = registry.asset_count.checked_add(1).unwrap();

    msg!("Registered asset: {} ({})", symbol, mint);

    Ok(())
}

/// Deactivate an asset (stops price updates)
pub fn deactivate_asset(ctx: Context<UpdateAssetConfig>) -> Result<()> {
    let registry = &ctx.accounts.registry;
    let asset_config = &mut ctx.accounts.asset_config;

    // Validate authority
    require_keys_eq!(
        ctx.accounts.authority.key(),
        registry.authority,
        OracleError::Unauthorized
    );

    asset_config.is_active = false;

    msg!("Deactivated asset: {}", asset_config.symbol_as_string());

    Ok(())
}

/// Activate an asset (resumes price updates)
pub fn activate_asset(ctx: Context<UpdateAssetConfig>) -> Result<()> {
    let registry = &ctx.accounts.registry;
    let asset_config = &mut ctx.accounts.asset_config;

    // Validate authority
    require_keys_eq!(
        ctx.accounts.authority.key(),
        registry.authority,
        OracleError::Unauthorized
    );

    asset_config.is_active = true;

    msg!("Activated asset: {}", asset_config.symbol_as_string());

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + AssetRegistry::SIZE,
        seeds = [AssetRegistry::SEED],
        bump
    )]
    pub registry: Account<'info, AssetRegistry>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(mint: Pubkey)]
pub struct RegisterAsset<'info> {
    #[account(mut, seeds = [AssetRegistry::SEED], bump = registry.bump)]
    pub registry: Account<'info, AssetRegistry>,

    #[account(
        init,
        payer = payer,
        space = 8 + AssetConfig::SIZE,
        seeds = [AssetConfig::SEED, mint.as_ref()],
        bump
    )]
    pub asset_config: Account<'info, AssetConfig>,

    #[account(
        init,
        payer = payer,
        space = 8 + PriceData::SIZE,
        seeds = [PriceData::SEED, mint.as_ref()],
        bump
    )]
    pub price_data: Account<'info, PriceData>,

    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAssetConfig<'info> {
    #[account(seeds = [AssetRegistry::SEED], bump = registry.bump)]
    pub registry: Account<'info, AssetRegistry>,

    #[account(
        mut,
        seeds = [AssetConfig::SEED, asset_config.mint.as_ref()],
        bump = asset_config.bump
    )]
    pub asset_config: Account<'info, AssetConfig>,

    pub authority: Signer<'info>,
}
