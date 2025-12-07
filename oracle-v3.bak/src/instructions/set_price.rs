use anchor_lang::prelude::*;
use crate::errors::OracleError;
use crate::state::*;
use std::str::FromStr;

// Hard-coded per-parameter updaters (mainnet relays)
const PARAM1_UPDATER: &str = "CGLezzdUpYmxiq3g5xdXxry8SWqwQbSxFJsdqfM13ro9";
const PARAM2_UPDATER: &str = "FprJrTPJq9eKsVxEVhQCyRChEMaYzyTwcnK8aNfCae2D";
const PARAM3_UPDATER: &str = "7FZvQQE1VDq2fFSuBmCCxmo8tPNm9LfYqF9BMkbyp1by";
const PARAM4_UPDATER: &str = "55MyuYePgkwAExNqtdNY4zahSyiM3stjjRm3Ym36sTA8";

/// Update price for a single asset
pub fn set_price(
    ctx: Context<SetPrice>,
    index: u8,
    price: i64,
    client_ts_ms: i64,
) -> Result<()> {
    let asset_config = &ctx.accounts.asset_config;
    let price_data = &mut ctx.accounts.price_data;
    let signer = ctx.accounts.signer.key();

    // Validate asset is active
    require!(asset_config.is_active, OracleError::AssetInactive);

    // Validate price is positive
    require!(price > 0, OracleError::InvalidPrice);

    // Validate signer matches index
    let expected = match index {
        1 => Pubkey::from_str(PARAM1_UPDATER).map_err(|_| error!(OracleError::BadKey))?,
        2 => Pubkey::from_str(PARAM2_UPDATER).map_err(|_| error!(OracleError::BadKey))?,
        3 => Pubkey::from_str(PARAM3_UPDATER).map_err(|_| error!(OracleError::BadKey))?,
        4 => Pubkey::from_str(PARAM4_UPDATER).map_err(|_| error!(OracleError::BadKey))?,
        _ => return err!(OracleError::BadIndex),
    };
    require_keys_eq!(signer, expected, OracleError::UnauthorizedForIndex);

    // Update price based on index
    match index {
        1 => {
            price_data.prices.param1 = price;
            price_data.prices.ts1 = client_ts_ms;
        }
        2 => {
            price_data.prices.param2 = price;
            price_data.prices.ts2 = client_ts_ms;
        }
        3 => {
            price_data.prices.param3 = price;
            price_data.prices.ts3 = client_ts_ms;
        }
        4 => {
            price_data.prices.param4 = price;
            price_data.prices.ts4 = client_ts_ms;
        }
        _ => unreachable!(),
    }

    price_data.last_update = client_ts_ms;

    emit!(PriceUpdated {
        mint: asset_config.mint,
        index,
        price,
        decimals: asset_config.decimals,
        client_ts_ms,
        slot: Clock::get()?.slot,
    });

    Ok(())
}

/// Batch update prices for multiple assets
pub fn batch_set_prices<'info>(
    ctx: Context<'_, '_, '_, 'info, BatchSetPrices<'info>>,
    index: u8,
    updates: Vec<PriceUpdate>,
    client_ts_ms: i64,
) -> Result<()> {
    let signer = ctx.accounts.signer.key();

    // Validate signer matches index
    let expected = match index {
        1 => Pubkey::from_str(PARAM1_UPDATER).map_err(|_| error!(OracleError::BadKey))?,
        2 => Pubkey::from_str(PARAM2_UPDATER).map_err(|_| error!(OracleError::BadKey))?,
        3 => Pubkey::from_str(PARAM3_UPDATER).map_err(|_| error!(OracleError::BadKey))?,
        4 => Pubkey::from_str(PARAM4_UPDATER).map_err(|_| error!(OracleError::BadKey))?,
        _ => return err!(OracleError::BadIndex),
    };
    require_keys_eq!(signer, expected, OracleError::UnauthorizedForIndex);

    // Validate batch size
    require!(updates.len() <= 100, OracleError::TooManyAssets);
    require!(
        updates.len() * 2 <= ctx.remaining_accounts.len(),
        OracleError::TooManyAssets
    );

    let slot = Clock::get()?.slot;

    // Process each update
    for (i, update) in updates.iter().enumerate() {
        // Validate price is positive
        require!(update.price > 0, OracleError::InvalidPrice);

        // Get accounts from remaining_accounts
        // Each asset needs 2 accounts: asset_config and price_data
        let asset_config_info = &ctx.remaining_accounts[i * 2];
        let price_data_info = &ctx.remaining_accounts[i * 2 + 1];

        // Deserialize accounts
        let mut asset_config = Account::<AssetConfig>::try_from(asset_config_info)?;
        let mut price_data = Account::<PriceData>::try_from(price_data_info)?;

        // Validate accounts match the mint
        require_keys_eq!(asset_config.mint, update.mint, OracleError::AssetNotFound);
        require_keys_eq!(price_data.mint, update.mint, OracleError::AssetNotFound);

        // Validate asset is active
        require!(asset_config.is_active, OracleError::AssetInactive);

        // Update price based on index
        match index {
            1 => {
                price_data.prices.param1 = update.price;
                price_data.prices.ts1 = client_ts_ms;
            }
            2 => {
                price_data.prices.param2 = update.price;
                price_data.prices.ts2 = client_ts_ms;
            }
            3 => {
                price_data.prices.param3 = update.price;
                price_data.prices.ts3 = client_ts_ms;
            }
            4 => {
                price_data.prices.param4 = update.price;
                price_data.prices.ts4 = client_ts_ms;
            }
            _ => unreachable!(),
        }

        price_data.last_update = client_ts_ms;

        // Serialize back
        price_data.exit(&ctx.program_id)?;

        emit!(PriceUpdated {
            mint: update.mint,
            index,
            price: update.price,
            decimals: asset_config.decimals,
            client_ts_ms,
            slot,
        });
    }

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PriceUpdate {
    pub mint: Pubkey,
    pub price: i64,
}

#[event]
pub struct PriceUpdated {
    pub mint: Pubkey,
    pub index: u8,
    pub price: i64,
    pub decimals: u8,
    pub client_ts_ms: i64,
    pub slot: u64,
}

#[derive(Accounts)]
pub struct SetPrice<'info> {
    #[account(
        seeds = [AssetConfig::SEED, asset_config.mint.as_ref()],
        bump = asset_config.bump
    )]
    pub asset_config: Account<'info, AssetConfig>,

    #[account(
        mut,
        seeds = [PriceData::SEED, price_data.mint.as_ref()],
        bump = price_data.bump
    )]
    pub price_data: Account<'info, PriceData>,

    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct BatchSetPrices<'info> {
    pub signer: Signer<'info>,
    // Remaining accounts passed dynamically:
    // [asset_config, price_data, asset_config, price_data, ...]
}
