use anchor_lang::prelude::*;
use std::str::FromStr;

declare_id!("7ARBeYF5rGCanAGiRaxhVpiuZZpGXazo5UJqHMoJgkuE");

// Hard-coded per-parameter updaters
const PARAM1_UPDATER: &str = "AivknDqDUqnvyYVmDViiB2bEHKyUK5HcX91gWL2zgTZ4";
const PARAM2_UPDATER: &str = "C3Un8Zf6pnyedk1AWDgqtZtKYLyiaZ4zwFPqJMVU2Trt";
const PARAM3_UPDATER: &str = "129arbPoM1UXBtYk99PXbp4w1csc4d5hFXnX4mh7nYc5";

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Asset {
    Btc = 1,
    Eth = 2,
    Sol = 3,
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
            _ => return err!(OracleError::BadIndex),
        };
        require_keys_eq!(signer, expected, OracleError::UnauthorizedForIndex);

        let s = &mut ctx.accounts.state;
        let t = match asset {
            x if x == Asset::Btc as u8 => &mut s.btc,
            x if x == Asset::Eth as u8 => &mut s.eth,
            x if x == Asset::Sol as u8 => &mut s.sol,
            _ => return err!(OracleError::BadAsset),
        };

        match index {
            1 => { t.param1 = price; t.ts1 = client_ts_ms; }
            2 => { t.param2 = price; t.ts2 = client_ts_ms; }
            3 => { t.param3 = price; t.ts3 = client_ts_ms; }
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

    pub fn set_update_authority(ctx: Context<SetUpdateAuthority>, new_auth: Pubkey) -> Result<()> {
        let s = &mut ctx.accounts.state;
        require_keys_eq!(ctx.accounts.signer.key(), s.update_authority, OracleError::Unauthorized);
        s.update_authority = new_auth;
        Ok(())
    }
}

#[event]
pub struct PriceUpdated {
    pub asset: u8,        // 1=BTC, 2=ETH, 3=SOL
    pub index: u8,        // 1,2,3
    pub price: i64,
    pub decimals: u8,     // 6
    pub client_ts_ms: i64,
    pub slot: u64,
}

#[account]
pub struct State {
    pub update_authority: Pubkey, // 32
    pub btc: Triplet,             // 48
    pub eth: Triplet,             // 48
    pub sol: Triplet,             // 48
    pub decimals: u8,             // 1
    pub bump: u8,                 // 1
}
impl State {
    pub const SIZE: usize = 32 + (Triplet::SIZE * 3) + 1 + 1; // 32 + 144 + 2 = 178
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct Triplet {
    pub param1: i64,
    pub param2: i64,
    pub param3: i64,
    pub ts1: i64,
    pub ts2: i64,
    pub ts3: i64,
}
impl Triplet {
    pub const SIZE: usize = 6 * 8; // 48
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

#[error_code]
pub enum OracleError {
    #[msg("Unauthorized (admin)")]
    Unauthorized,
    #[msg("Bad asset (must be 1=BTC,2=ETH,3=SOL)")]
    BadAsset,
    #[msg("Index must be 1, 2, or 3")]
    BadIndex,
    #[msg("Signer not authorized for the requested index")]
    UnauthorizedForIndex,
    #[msg("Bad key literal")]
    BadKey,
}

