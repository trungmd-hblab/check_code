
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
