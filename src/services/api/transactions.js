import { TransactionBuilder, ChainTypes, ops, PrivateKey } from 'bitsharesjs';
import { ChainConfig } from 'bitsharesjs-ws';
import { getUser } from './account';
import { encryptMemo, getMemoPrivKey } from '../../utils';
import { getCachedComissions } from './parameters';


const signTransaction = async (transaction, { active, owner }) => {
  const pubkeys = [active, owner].map(privkey => privkey.toPublicKey().toPublicKeyString());
  const requiredPubkeys = await transaction.get_required_signatures(pubkeys);
  requiredPubkeys.forEach(requiredPubkey => {
    if (active.toPublicKey().toPublicKeyString() === requiredPubkey) {
      transaction.add_signer(active, requiredPubkey);
    }
    if (owner.toPublicKey().toPublicKeyString() === requiredPubkey) {
      transaction.add_signer(owner, requiredPubkey);
    }
  });
  return transaction;
};

const buildAndBroadcast = async (type, payload, { active, owner }) => {
  const transaction = new TransactionBuilder();
  transaction.add_type_operation(type, payload);
  await signTransaction(transaction, { active, owner });
  await transaction.update_head_block();
  await transaction.set_required_fees();

  const res = await transaction.broadcast();
  return res;
};

const transferAsset = async (fromId, to, assetId, amount, keys, memo = false) => {
  const toAccount = await getUser(to);
  if (!toAccount.success) {
    return { success: false, error: 'Destination user not found' };
  }

  const {
    data: {
      account: {
        options: {
          memo_key: memoKey
        }
      }
    }
  } = await getUser(fromId);

  const memoPrivate = getMemoPrivKey(keys, memoKey);

  if (!memoPrivate) {
    return { success: false, error: 'Cant find key to encrypt memo' };
  }

  const transferObject = {
    fee: {
      amount: 0,
      asset_id: '1.3.0'
    },
    from: fromId,
    to: toAccount.data.account.id,
    amount: {
      amount,
      asset_id: assetId
    }
  };

  if (memo) {
    try {
      transferObject.memo = encryptMemo(memo, memoPrivate, toAccount.data.account.options.memo_key);
    } catch (error) {
      return { success: false, error: 'Encrypt memo failed' };
    }
  }

  return new Promise(async (resolve) => {
    const broadcastTimeout = setTimeout(() => {
      resolve({ success: false, error: 'expired' });
    }, ChainConfig.expire_in_secs * 2000);

    try {
      await buildAndBroadcast('transfer', transferObject, keys);
      clearTimeout(broadcastTimeout);
      resolve({ success: true });
    } catch (error) {
      clearTimeout(broadcastTimeout);
      resolve({ success: false, error: 'broadcast error' });
    }
  });
};

const getMemoPrice = (memo) => {
  const privKey = '5KikQ23YhcM7jdfHbFBQg1G7Do5y6SgD9sdBZq7BqQWXmNH7gqo';
  const memoToKey = 'BTS8eLeqSZZtB1YHdw7KjQxRSRmaKAseCxhUSqaLxUdqvdGpp6nck';
  const pKey = PrivateKey.fromWif(privKey);

  const { fees } = getCachedComissions();
  const operations = Object.keys(ChainTypes.operations);
  const opIndex = operations.indexOf('transfer');
  const { fee, price_per_kbyte: kbytePrice } = fees[opIndex][1];

  const encrypted = encryptMemo(memo, pKey, memoToKey);

  const serialized = ops.memo_data.fromObject(encrypted);
  const stringified = JSON.stringify(ops.memo_data.toHex(serialized));
  const byteLength = Buffer.byteLength(stringified, 'hex');
  const memoFee = Math.floor((kbytePrice * byteLength) / 1024);

  return fee + memoFee;
};

const placeOrders = async ({ orders, keys }) => {
  const transaction = new TransactionBuilder();
  console.log('placing orders : ', orders);
  orders.forEach(o => transaction.add_type_operation('limit_order_create', o));


  return new Promise(async (resolve) => {
    const broadcastTimeout = setTimeout(() => {
      resolve({ success: false, error: 'expired' });
    }, ChainConfig.expire_in_secs * 2000);

    const { active, owner } = keys;
    signTransaction(transaction, { active, owner });

    try {
      await transaction.set_required_fees();
      await transaction.broadcast();
      clearTimeout(broadcastTimeout);
      resolve({ success: true });
    } catch (error) {
      clearTimeout(broadcastTimeout);
      resolve({ success: false, error: 'broadcast error' });
    }
  });
};

export default {
  transferAsset,
  signTransaction,
  placeOrders,
  getMemoPrice
};
