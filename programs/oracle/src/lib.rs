use anchor_lang::prelude::*;
use std::str::FromStr;

declare_id!("LuS6XnQ3qNXqNQvAJ3akXnEJRBv9XNoUricjMgTyCxX");

// Hard-coded per-parameter updaters (mainnet relays)
const PARAM1_UPDATER: &str = "CGLezzdUpYmxiq3g5xdXxry8SWqwQbSxFJsdqfM13ro9"; // mn_relay1.json
const PARAM2_UPDATER: &str = "FprJrTPJq9eKsVxEVhQCyRChEMaYzyTwcnK8aNfCae2D"; // mn_relay2.json
const PARAM3_UPDATER: &str = "7FZvQQE1VDq2fFSuBmCCxmo8tPNm9LfYqF9BMkbyp1by"; // mn_relay3.json
const PARAM4_UPDATER: &str = "55MyuYePgkwAExNqtdNY4zahSyiM3stjjRm3Ym36sTA8"; // Reserved for future use

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Asset {
    Btc = 1,
    Eth = 2,
    Sol = 3,
    Hype = 4,
    Zec = 5,
}

#[program]
pub mod oracle {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, update_authority: Pubkey) -> Result<()> {
        let s = &mut ctx.accounts.state;
        s.update_authority = update_authority;
        s.decimals = 6;
        s.bump = ctx.bumps.state;
        s.btc = Triplet::default();
        s.eth = Triplet::default();
        s.sol = Triplet::default();
        s.hype = Triplet::default();
        s.zec = Triplet::default();
        Ok(())
    }

    pub fn set_price(
        ctx: Context<SetPrice>,
        asset: u8,
        index: u8,
        price: i64,
        client_ts_ms: i64,
    ) -> Result<()> {
        let signer = ctx.accounts.signer.key();

        let expected = match index {
            1 => Pubkey::from_str(PARAM1_UPDATER).map_err(|_| error!(OracleError::BadKey))?,
            2 => Pubkey::from_str(PARAM2_UPDATER).map_err(|_| error!(OracleError::BadKey))?,
            3 => Pubkey::from_str(PARAM3_UPDATER).map_err(|_| error!(OracleError::BadKey))?,
            4 => Pubkey::from_str(PARAM4_UPDATER).map_err(|_| error!(OracleError::BadKey))?,
            _ => return err!(OracleError::BadIndex),
        };
        require_keys_eq!(signer, expected, OracleError::UnauthorizedForIndex);

        let s = &mut ctx.accounts.state;
        let t = match asset {
            x if x == Asset::Btc as u8 => &mut s.btc,
            x if x == Asset::Eth as u8 => &mut s.eth,
            x if x == Asset::Sol as u8 => &mut s.sol,
            x if x == Asset::Hype as u8 => &mut s.hype,
            x if x == Asset::Zec as u8 => &mut s.zec,
            _ => return err!(OracleError::BadAsset),
        };

        match index {
            1 => { t.param1 = price; t.ts1 = client_ts_ms; }
            2 => { t.param2 = price; t.ts2 = client_ts_ms; }
            3 => { t.param3 = price; t.ts3 = client_ts_ms; }
            4 => { t.param4 = price; t.ts4 = client_ts_ms; }
            _ => unreachable!(),
        }

        emit!(PriceUpdated {
            asset,
            index,
            price,
            decimals: s.decimals,
            client_ts_ms,
            slot: Clock::get()?.slot,
        });

        Ok(())
    }

    pub fn batch_set_prices(
        ctx: Context<SetPrice>,
        index: u8,
        btc_price: i64,
        eth_price: i64,
        sol_price: i64,
        hype_price: i64,
        zec_price: i64,
        client_ts_ms: i64,
    ) -> Result<()> {
        let signer = ctx.accounts.signer.key();

        let expected = match index {
            1 => Pubkey::from_str(PARAM1_UPDATER).map_err(|_| error!(OracleError::BadKey))?,
            2 => Pubkey::from_str(PARAM2_UPDATER).map_err(|_| error!(OracleError::BadKey))?,
            3 => Pubkey::from_str(PARAM3_UPDATER).map_err(|_| error!(OracleError::BadKey))?,
            4 => Pubkey::from_str(PARAM4_UPDATER).map_err(|_| error!(OracleError::BadKey))?,
            _ => return err!(OracleError::BadIndex),
        };
        require_keys_eq!(signer, expected, OracleError::UnauthorizedForIndex);

        let s = &mut ctx.accounts.state;
        let slot = Clock::get()?.slot;

        // Update all 5 assets in one instruction
        match index {
            1 => {
                s.btc.param1 = btc_price;
                s.btc.ts1 = client_ts_ms;
                s.eth.param1 = eth_price;
                s.eth.ts1 = client_ts_ms;
                s.sol.param1 = sol_price;
                s.sol.ts1 = client_ts_ms;
                s.hype.param1 = hype_price;
                s.hype.ts1 = client_ts_ms;
                s.zec.param1 = zec_price;
                s.zec.ts1 = client_ts_ms;
            }
            2 => {
                s.btc.param2 = btc_price;
                s.btc.ts2 = client_ts_ms;
                s.eth.param2 = eth_price;
                s.eth.ts2 = client_ts_ms;
                s.sol.param2 = sol_price;
                s.sol.ts2 = client_ts_ms;
                s.hype.param2 = hype_price;
                s.hype.ts2 = client_ts_ms;
                s.zec.param2 = zec_price;
                s.zec.ts2 = client_ts_ms;
            }
            3 => {
                s.btc.param3 = btc_price;
                s.btc.ts3 = client_ts_ms;
                s.eth.param3 = eth_price;
                s.eth.ts3 = client_ts_ms;
                s.sol.param3 = sol_price;
                s.sol.ts3 = client_ts_ms;
                s.hype.param3 = hype_price;
                s.hype.ts3 = client_ts_ms;
                s.zec.param3 = zec_price;
                s.zec.ts3 = client_ts_ms;
            }
            4 => {
                s.btc.param4 = btc_price;
                s.btc.ts4 = client_ts_ms;
                s.eth.param4 = eth_price;
                s.eth.ts4 = client_ts_ms;
                s.sol.param4 = sol_price;
                s.sol.ts4 = client_ts_ms;
                s.hype.param4 = hype_price;
                s.hype.ts4 = client_ts_ms;
                s.zec.param4 = zec_price;
                s.zec.ts4 = client_ts_ms;
            }
            _ => unreachable!(),
        }

        // Emit events for all assets
        emit!(PriceUpdated {
            asset: Asset::Btc as u8,
            index,
            price: btc_price,
            decimals: s.decimals,
            client_ts_ms,
            slot,
        });
        emit!(PriceUpdated {
            asset: Asset::Eth as u8,
            index,
            price: eth_price,
            decimals: s.decimals,
            client_ts_ms,
            slot,
        });
        emit!(PriceUpdated {
            asset: Asset::Sol as u8,
            index,
            price: sol_price,
            decimals: s.decimals,
            client_ts_ms,
            slot,
        });
        emit!(PriceUpdated {
            asset: Asset::Hype as u8,
            index,
            price: hype_price,
            decimals: s.decimals,
            client_ts_ms,
            slot,
        });
        emit!(PriceUpdated {
            asset: Asset::Zec as u8,
            index,
            price: zec_price,
            decimals: s.decimals,
            client_ts_ms,
            slot,
        });

        Ok(())
    }

    pub fn set_update_authority(ctx: Context<SetUpdateAuthority>, new_auth: Pubkey) -> Result<()> {
        let s = &mut ctx.accounts.state;
        require_keys_eq!(ctx.accounts.signer.key(), s.update_authority, OracleError::Unauthorized);
        s.update_authority = new_auth;
        Ok(())
    }

    pub fn close_state(ctx: Context<CloseState>) -> Result<()> {
        // Manually transfer lamports and zero out data
        let state_lamports = ctx.accounts.state.lamports();
        **ctx.accounts.state.lamports.borrow_mut() = 0;
        **ctx.accounts.recipient.lamports.borrow_mut() += state_lamports;
        Ok(())
    }
}

#[event]
pub struct PriceUpdated {
    pub asset: u8,        // 1=BTC, 2=ETH, 3=SOL, 4=HYPE, 5=ZEC
    pub index: u8,        // 1,2,3,4
    pub price: i64,
    pub decimals: u8,     // 6
    pub client_ts_ms: i64,
    pub slot: u64,
}

#[account]
pub struct State {
    pub update_authority: Pubkey, // 32
    pub btc: Triplet,             // 64
    pub eth: Triplet,             // 64
    pub sol: Triplet,             // 64
    pub hype: Triplet,            // 64
    pub zec: Triplet,             // 64
    pub decimals: u8,             // 1
    pub bump: u8,                 // 1
}
impl State {
    pub const SIZE: usize = 32 + (Triplet::SIZE * 5) + 1 + 1; // 32 + 320 + 2 = 354
}

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
    pub const SIZE: usize = 8 * 8; // 64
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + State::SIZE,
        seeds = [b"state_v2"],   // <<< CHANGED
        bump
    )]
    pub state: Account<'info, State>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPrice<'info> {
    #[account(mut, seeds = [b"state_v2"], bump = state.bump)] // <<< CHANGED
    pub state: Account<'info, State>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetUpdateAuthority<'info> {
    #[account(mut, seeds = [b"state_v2"], bump = state.bump)] // <<< CHANGED
    pub state: Account<'info, State>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseState<'info> {
    /// CHECK: We use AccountInfo instead of Account to avoid deserialization
    /// This allows closing accounts with old structure
    #[account(
        mut,
        seeds = [b"state_v2"],
        bump
    )]
    pub state: UncheckedAccount<'info>,
    pub authority: Signer<'info>,
    /// CHECK: Receives the lamports from the closed account
    #[account(mut)]
    pub recipient: SystemAccount<'info>,
}

#[error_code]
pub enum OracleError {
    #[msg("Unauthorized (admin)")]
    Unauthorized,
    #[msg("Bad asset (must be 1=BTC,2=ETH,3=SOL,4=HYPE,5=ZEC)")]
    BadAsset,
    #[msg("Index must be 1, 2, 3, or 4")]
    BadIndex,
    #[msg("Signer not authorized for the requested index")]
    UnauthorizedForIndex,
    #[msg("Bad key literal")]
    BadKey,
}

