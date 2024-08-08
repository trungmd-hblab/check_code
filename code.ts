import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { SoftDeleteModel } from 'mongoose-delete';
import { ClientMoneyBalanceHistory } from 'schema/client-money-balance-history.schema';
import { Client, ClientDocument } from 'schema/client.schema';
import {
  ClientMoneyBalanceHistoryType,
  UpdateMoneyClientType,
} from 'src/core/constants/common.constant';
import { WithTransaction } from 'src/core/plugins/transaction.plugin';
import { toObjectId } from 'src/core/utils/common.util';
import { AtmDto } from 'src/infrastructure/hook/dtos/atm.dto';
import { ClientService } from './client.service';
import { isNumber, toNumber, trim } from 'lodash';

@Injectable()
export class AtmService {
  constructor(
    @InjectModel(Client.name)
    private clientModel: SoftDeleteModel<ClientDocument>,
    @InjectModel(ClientMoneyBalanceHistory.name)
    private ClientMoneyBalanceHistoryModel: Model<ClientMoneyBalanceHistory>,
    private readonly clientService: ClientService,
    @InjectConnection() private connection: Connection,
  ) { }

  @WithTransaction()
  async upsertTransactionAtm(body: AtmDto, session?) {
    const totalUser = await this.clientModel.countDocuments();
    let insertData = await this.tranformDataAtm(body, totalUser);
    if (!insertData) {
      return;
    }

    const transactionIds = insertData.map((item) => {
      return item.transactionID;
    });

    // check transaction history

    const dataHaveTransactionHistory =
      await this.ClientMoneyBalanceHistoryModel.find({
        transactionAtmId: {
          $in: transactionIds,
        },
      });

    if (dataHaveTransactionHistory.length) {
      insertData = insertData.filter((item) => {
        return !dataHaveTransactionHistory.find((data) => {
          return (
            data.clientId.toString() === item.clientId.toString() &&
            data.transactionAtmId === item.transactionID
          );
        });
      });
    }

    console.log('insertData', insertData);

    await Promise.all(
      insertData?.map(async (item) => {
        await this.clientService.apiHookUpdateMoneyForClient(
          toObjectId(item.clientId),
          {
            money: item.money,
            type: UpdateMoneyClientType.ADD,
            reason: 'ATM payment',
            transactionId: item.transactionID,
          },
          ClientMoneyBalanceHistoryType.ATM_TOP_UP,
          session,
        );
      }),
    );

    return true;
  }

  async tranformDataAtm(body: AtmDto, totalUser: number) {
    const dataArray = body.data;
    const paymentCodes = [];
    const insertData = [];

    dataArray?.forEach((item) => {
      const paymentDescription = trim(item.description, ' ');
      const descriptionArray = paymentDescription.split(' ');

      // trường hợp chuyển khoản bình thường
      const paymentCode = trim(descriptionArray[0], ' ');
      if (isNumber(toNumber(paymentCode)) && Number(paymentCode) <= totalUser)
        paymentCodes.push(paymentCode);
      else {
        // trường hợp mã chuyển khoản nằm trong thằng đầu tiên
        let a = paymentCode.split(/[,-.!_:;?@]/);
        a = a.filter((item) => item);
        let code1;
        if (a?.length > 1) {
          code1 = a[a?.length - 1];
          if (code1) {
            if (isNumber(toNumber(code1)) && Number(code1) <= totalUser) {
              paymentCodes.push(code1);
            } else {
              // trường hợp 1 chuyển khoản với thằng đầu tiên là MBVCB
              if (
                a[0] === 'MBVCB' &&
                a?.length === 5 &&
                isNumber(toNumber(a[3])) &&
                Number(a[3]) <= totalUser
              ) {
                paymentCodes.push(a[3]);
              }
            }
          }
        } else {
          descriptionArray.forEach((jtem) => {
            if (isNumber(toNumber(jtem)) && Number(jtem) <= totalUser) {
              paymentCodes.push(jtem);
              return;
            }
          });
        }
      }
    });

    const clients = await this.clientModel.find({
      code: {
        $in: paymentCodes,
      },
    });

    dataArray?.forEach((item) => {
      let itemCode = '';
      const paymentDescription = trim(item.description, ' ');
      const descriptionArray = paymentDescription.split(' ');

      // trường hợp chuyển khoản bình thường
      const paymentCode = trim(descriptionArray[0], ' ');
      if (isNumber(toNumber(paymentCode)) && Number(paymentCode) <= totalUser)
        itemCode = paymentCode;
      else {
        // trường hợp mã chuyển khoản nằm trong thằng đầu tiên
        let a = paymentCode.split(/[,-.!_:;?@]/);
        a = a.filter((item) => item);
        let code1;
        if (a?.length > 1) {
          code1 = a[a?.length - 1];
          if (code1) {
            if (isNumber(toNumber(code1)) && Number(code1) <= totalUser) {
              itemCode = code1;
            } else {
              // trường hợp 1 chuyển khoản với thằng đầu tiên là MBVCB
              if (
                a[0] === 'MBVCB' &&
                a?.length === 5 &&
                isNumber(toNumber(a[3])) &&
                Number(a[3]) <= totalUser
              ) {
                itemCode = a[3];
              }
            }
          }
        } else {
          descriptionArray.forEach((jtem) => {
            if (isNumber(toNumber(jtem)) && Number(jtem) <= totalUser) {
              itemCode = jtem;
              return;
            }
          });
        }
      }
      const client = clients?.find((item) => item.code === itemCode);
      if (client) {
        insertData.push({
          clientId: client._id,
          money: Number(item.amount),
          transactionID: item.transactionID,
        });
      }
    });

    if (!clients.length || !insertData.length) {
      return;
    }

    return insertData;
  }
}
